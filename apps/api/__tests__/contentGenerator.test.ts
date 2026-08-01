import request from 'supertest';
import { app } from '../src/app';
import * as llmService from '../src/services/llmService';

jest.mock('../src/services/llmService');

const mockedCallGroq = llmService.callGroq as jest.MockedFunction<typeof llmService.callGroq>;

describe('POST /api/content/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with title variants when assetType is title', async () => {
    const mockVariants = [
      'Best SEO Tips for 2026',
      'SEO Tips for Beginners Guide',
      '10 Powerful SEO Tips for Growth',
      'SEO Tips to Rank Higher Fast',
    ];

    mockedCallGroq.mockResolvedValue({ variants: mockVariants });

    const res = await request(app)
      .post('/api/content/generate')
      .send({ targetKeyword: 'SEO tips', assetType: 'title' })
      .expect(200);

    expect(res.body).toHaveProperty('variants');
    expect(Array.isArray(res.body.variants)).toBe(true);
    expect(res.body.variants.length).toBeGreaterThanOrEqual(3);
    expect(res.body.variants.length).toBeLessThanOrEqual(5);
    expect(res.body.variants).toEqual(mockVariants);
  });

  it('should normalize title variants to <= 60 chars when long variants are returned', async () => {
    const longVariant = 'This is a very long title variant that should be over sixty characters indeed it is way too long for sure';

    mockedCallGroq.mockResolvedValue({ variants: [longVariant] });

    const res = await request(app)
      .post('/api/content/generate')
      .send({ targetKeyword: 'seo', assetType: 'title' })
      .expect(200);

    expect(res.body).toHaveProperty('variants');
    expect(res.body.variants[0].length).toBeLessThanOrEqual(60);
  });

  it('should return 200 with FAQ items when assetType is faq', async () => {
    const mockItems = [
      { question: 'What is SEO?', answer: 'Search Engine Optimization SEO is the practice of improving a website to increase its visibility in search engine results pages like Google and Bing. It involves various techniques including keyword research content optimization technical improvements and link building to attract organic traffic and improve rankings for relevant search queries.' },
      { question: 'Why is keyword research important?', answer: 'Keyword research helps you understand what terms your target audience uses when searching online for products or services like yours. By identifying high volume relevant keywords you can create content that matches user intent and ranks well in search results driving qualified traffic to your website consistently over time.' },
      { question: 'How long does SEO take?', answer: 'SEO is a long term strategy that typically takes three to six months to show meaningful results in search engine rankings and traffic. The timeline depends on several factors like competition level website age content quality and the number of backlinks you can earn through consistent outreach and guest posting.' },
      { question: 'What are backlinks in SEO?', answer: 'Backlinks are links from other websites that point to your site and they serve as votes of confidence signaling to search engines that your content is valuable and trustworthy. High quality backlinks from authoritative and relevant domains are one of the most important ranking factors that Google uses to determine search positions.' },
      { question: 'Is SEO worth investing in?', answer: 'Yes SEO is extremely valuable for businesses of all sizes as it provides a cost effective way to attract customers who are actively searching for your products. Unlike paid advertising which stops working when you stop paying organic search traffic compounds over time and delivers sustainable long term growth without ongoing ad spend.' },
    ];

    mockedCallGroq.mockResolvedValue({ items: mockItems });

    const res = await request(app)
      .post('/api/content/generate')
      .send({ targetKeyword: 'SEO basics', assetType: 'faq' })
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(4);
    expect(res.body.items.length).toBeLessThanOrEqual(6);
    expect(res.body.items).toEqual(mockItems);

    for (const item of mockItems) {
      const wordCount = item.answer.trim().split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeGreaterThanOrEqual(40);
      expect(wordCount).toBeLessThanOrEqual(80);
    }
  });

  it('should return valid:false when schema generation fails validation and retry also fails', async () => {
    const invalidSchema = {
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is SEO?',
          },
        ],
      },
    };

    mockedCallGroq.mockResolvedValue(invalidSchema);

    const res = await request(app)
      .post('/api/content/generate')
      .send({ targetKeyword: 'SEO', assetType: 'schema', schemaType: 'FAQPage' })
      .expect(200);

    expect(res.body).toEqual({
      jsonLd: null,
      valid: false,
      error: 'Could not generate valid schema after retry',
    });
    expect(mockedCallGroq).toHaveBeenCalledTimes(2);
  });

  it('should return 400 when assetType is schema and schemaType is missing', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .send({ targetKeyword: 'SEO', assetType: 'schema' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toBe('schemaType is required when assetType is schema');
  });
});
