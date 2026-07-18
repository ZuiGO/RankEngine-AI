import json
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from bson import ObjectId

def extract_schema_objects(data) -> list:
    """Recursively extract all objects containing '@type' from a JSON-LD structure."""
    objects = []
    if isinstance(data, list):
        for item in data:
            objects.extend(extract_schema_objects(item))
    elif isinstance(data, dict):
        if "@type" in data:
            objects.append(data)
        # Check for @graph or other nested objects
        for key, val in data.items():
            if key == "@graph":
                objects.extend(extract_schema_objects(val))
            elif isinstance(val, (dict, list)):
                objects.extend(extract_schema_objects(val))
    return objects

def validate_json_ld(html_content: str, url: str, crawl_job_id: str) -> list:
    issues = []
    if not html_content:
        return issues

    soup = BeautifulSoup(html_content, "html.parser")
    
    # Extract all JSON-LD blocks
    schema_objects = []
    scripts = soup.find_all("script", type="application/ld+json")
    for script in scripts:
        try:
            content = script.string
            if content:
                data = json.loads(content.strip())
                schema_objects.extend(extract_schema_objects(data))
        except Exception:
            # Malformed JSON-LD script block completely
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "critical",
                "category": "schema",
                "url": url,
                "description": "Page contains a malformed JSON-LD script block that failed to parse",
                "recommendation": "Ensure JSON-LD structure is valid JSON with correctly escaped strings."
            })

    # Track parsed schemas
    has_faq = False
    has_howto = False
    has_article = False
    valid_schema_types = set()

    # Validate found schemas
    for obj in schema_objects:
        obj_type = obj.get("@type")
        if not obj_type:
            continue

        # Handle type as list or string
        types = obj_type if isinstance(obj_type, list) else [obj_type]
        
        # 1. FAQPage Validation
        if "FAQPage" in types:
            has_faq = True
            issue_count_before = len(issues)
            main_entity = obj.get("mainEntity")
            if not main_entity:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "critical",
                    "category": "schema",
                    "url": url,
                    "description": "FAQPage schema is missing the required 'mainEntity' property",
                    "recommendation": "Add a 'mainEntity' array containing the list of Question objects."
                })
            else:
                entities = main_entity if isinstance(main_entity, list) else [main_entity]
                for idx, ent in enumerate(entities):
                    if not isinstance(ent, dict):
                        continue
                    q_name = ent.get("name")
                    if not q_name or not str(q_name).strip():
                        issues.append({
                            "crawlJobId": ObjectId(crawl_job_id),
                            "severity": "critical",
                            "category": "schema",
                            "url": url,
                            "description": f"Question #{idx + 1} in FAQPage is missing the question text 'name' property",
                            "recommendation": "Provide a descriptive question string in the 'name' field of the Question object."
                        })
                    
                    answer = ent.get("acceptedAnswer")
                    if not answer:
                        issues.append({
                            "crawlJobId": ObjectId(crawl_job_id),
                            "severity": "critical",
                            "category": "schema",
                            "url": url,
                            "description": f"Question #{idx + 1} ('{q_name or 'Unknown'}') in FAQPage is missing the 'acceptedAnswer' property",
                            "recommendation": "Add an 'acceptedAnswer' object of type 'Answer' containing the response text."
                        })
                    elif isinstance(answer, dict):
                        ans_text = answer.get("text")
                        if not ans_text or not str(ans_text).strip():
                            issues.append({
                                "crawlJobId": ObjectId(crawl_job_id),
                                "severity": "critical",
                                "category": "schema",
                                "url": url,
                                "description": f"Answer for Question #{idx + 1} ('{q_name or 'Unknown'}') in FAQPage is missing the answer 'text' property",
                                "recommendation": "Provide a clear text response inside the 'text' property of the acceptedAnswer object."
                            })

            if len(issues) == issue_count_before:
                valid_schema_types.add("FAQPage")

        # 2. HowTo Validation
        if "HowTo" in types:
            has_howto = True
            issue_count_before = len(issues)
            steps = obj.get("step")
            if not steps:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "critical",
                    "category": "schema",
                    "url": url,
                    "description": "HowTo schema is missing the required 'step' property",
                    "recommendation": "Add a 'step' array containing the ordered sequence of instruction steps."
                })
            else:
                step_list = steps if isinstance(steps, list) else [steps]
                for idx, step in enumerate(step_list):
                    if not isinstance(step, dict):
                        continue
                    # A step can be a HowToStep or HowToSection containing nested steps
                    step_type = step.get("@type", "HowToStep")
                    if step_type == "HowToSection":
                        nested_steps = step.get("itemListElement", [])
                        nested_list = nested_steps if isinstance(nested_steps, list) else [nested_steps]
                        for n_idx, n_step in enumerate(nested_list):
                            if isinstance(n_step, dict):
                                n_name = n_step.get("name")
                                n_text = n_step.get("text")
                                if not n_name or not str(n_name).strip() or not n_text or not str(n_text).strip():
                                    issues.append({
                                        "crawlJobId": ObjectId(crawl_job_id),
                                        "severity": "critical",
                                        "category": "schema",
                                        "url": url,
                                        "description": f"HowTo section step missing name or text (Section: '{step.get('name', 'Unknown')}', Step #{n_idx + 1})",
                                        "recommendation": "Ensure all instruction steps inside sections have both a short name and detailed text description."
                                    })
                    else:
                        s_name = step.get("name")
                        s_text = step.get("text")
                        if not s_name or not str(s_name).strip() or not s_text or not str(s_text).strip():
                            issues.append({
                                "crawlJobId": ObjectId(crawl_job_id),
                                "severity": "critical",
                                "category": "schema",
                                "url": url,
                                "description": f"HowTo step #{idx + 1} is missing its 'name' or 'text' description properties",
                                "recommendation": "Ensure each HowToStep contains a short summary 'name' and complete description 'text'."
                            })

            if len(issues) == issue_count_before:
                valid_schema_types.add("HowTo")

        # 3. Article Validation (and sub-types like BlogPosting, NewsArticle)
        article_types = {"Article", "BlogPosting", "NewsArticle", "TechArticle", "ScholarlyArticle"}
        if any(t in article_types for t in types):
            has_article = True
            issue_count_before = len(issues)
            headline = obj.get("headline")
            if not headline or not str(headline).strip():
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "critical",
                    "category": "schema",
                    "url": url,
                    "description": "Article schema is missing the required 'headline' property",
                    "recommendation": "Add a headline string matching the page main title header."
                })

            author = obj.get("author")
            if not author:
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "critical",
                    "category": "schema",
                    "url": url,
                    "description": "Article schema is missing the required 'author' property",
                    "recommendation": "Add an 'author' object containing the writer's name and type (Person/Organization)."
                })
            else:
                authors = author if isinstance(author, list) else [author]
                for a in authors:
                    a_name = a.get("name") if isinstance(a, dict) else str(a)
                    if not a_name or not str(a_name).strip():
                        issues.append({
                            "crawlJobId": ObjectId(crawl_job_id),
                            "severity": "critical",
                            "category": "schema",
                            "url": url,
                            "description": "Article author property is missing a valid 'name'",
                            "recommendation": "Provide the name of the author (e.g. Person author name) in the author schema object."
                        })
            
            date_published = obj.get("datePublished")
            if not date_published or not str(date_published).strip():
                issues.append({
                    "crawlJobId": ObjectId(crawl_job_id),
                    "severity": "critical",
                    "category": "schema",
                    "url": url,
                    "description": "Article schema is missing the required 'datePublished' date property",
                    "recommendation": "Provide the ISO 8601 publication timestamp in the 'datePublished' property."
                })

            if len(issues) == issue_count_before:
                valid_schema_types.add("Article")

    # Emit a positive result for each valid schema type. The crawler converts
    # these per-page signals into one crawl-level summary per schema type.
    for schema_type in sorted(valid_schema_types):
        issues.append({
            "crawlJobId": ObjectId(crawl_job_id),
            "severity": "passed",
            "category": "schema",
            "url": url,
            "description": f"Page has valid {schema_type} structured data",
            "recommendation": "No action needed."
        })

    # Scan content for missing schema opportunities (Missed AI Overview Opportunities)
    # Extract all heading text
    heading_texts = []
    for tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
        for el in soup.find_all(tag):
            txt = el.get_text().strip().lower()
            if txt:
                heading_texts.append(txt)

    # 1. Missing FAQPage opportunity check
    if not has_faq:
        faq_keywords = ["frequently asked questions", "faq", "faqs"]
        if any(any(kw in h_txt for kw in faq_keywords) for h_txt in heading_texts):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "schema",
                "url": url,
                "description": "Missed AI Overview eligibility opportunity: Page contains an FAQ heading but no FAQPage schema is defined",
                "recommendation": "Implement FAQPage structured data markup to qualify for FAQ Rich Snippets and AI Overviews."
            })

    # 2. Missing HowTo opportunity check
    if not has_howto:
        howto_keywords = ["how to", "how-to", "steps to"]
        if any(any(kw in h_txt for kw in howto_keywords) for h_txt in heading_texts):
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "schema",
                "url": url,
                "description": "Missed AI Overview eligibility opportunity: Page contains a 'How-To' style heading but no HowTo schema is defined",
                "recommendation": "Integrate HowTo structured schema tags detailing steps to increase visual search visibility."
            })

    # 3. Missing Article opportunity check
    if not has_article:
        parsed_url = urlparse(url)
        path = parsed_url.path.lower()
        is_blog_url = any(seg in path for seg in ["/blog/", "/article/", "/news/"])
        has_article_tag = soup.find("article") is not None
        
        if is_blog_url or has_article_tag:
            issues.append({
                "crawlJobId": ObjectId(crawl_job_id),
                "severity": "warning",
                "category": "schema",
                "url": url,
                "description": "Missed AI Overview eligibility opportunity: Page appears to be an article or blog post but no Article schema is defined",
                "recommendation": "Configure Article, BlogPosting, or NewsArticle structured schema to improve placement in AI summaries."
            })

    return issues
