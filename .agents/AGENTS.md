# RankEngine AI — Project Rules & Engineering Guidelines

These rules are distilled from project retrospectives and lessons learned ([rankengine-ai-lessons-learned.md](file:///Users/macbook/RankEngine-AI/rankengine-ai-lessons-learned.md)). They apply to all developers and AI coding agents working on this repository.

---

## 1. Boundary & Seam Verification First
Bugs cluster at the connective tissue between services, not inside single functions.
- **Cross-Service Contracts**: Always verify data field names between Python workers and Node.js API handlers (e.g., `rawResultsRef` vs `crawlResultId`).
- **Routing & Proxying**: Ensure API endpoints created on the server are properly routed in Nginx/gateway configurations.
- **UI Access Paths**: When creating backend capabilities, verify that frontend lookup tables and navigation links are updated to expose the feature.
- **State Initialization**: Ensure dependent data structures are created reliably during flow setup (e.g., project/user creation handoffs).

---

## 2. "The Code Exists" ≠ "The Feature Works"
- **End-to-End Verification**: Never rely solely on isolated unit tests or static code reading to mark a feature complete.
- **User Flow Validation**: Verify features through full end-to-end execution, validating the actual output produced by data providers and downstream consumers.

---

## 3. Refactor Safety & Test Inventory
- **Test Preservation Audit**: Before removing or refactoring any subsystem (e.g., auth, billing, multi-tenancy), construct a before/after inventory of all test files.
- **Collateral Damage Prevention**: Do not delete test files containing coverage for features that remain in the codebase. Explicitly rewrite or relocate tests rather than dropping coverage.

---

## 4. Environment, Portability & Rate Limiting
- **Native Binaries & `.gitignore`**: Never commit `node_modules` or platform-specific native binaries (e.g., `bcrypt`, bundler binaries). Verify `.gitignore` rules prevent build artifacts from leaking into version control.
- **Realistic Rate Limits**: Rate limiters must be tested under realistic usage patterns (e.g., polling loops during audits). Do not silently disable security or rate-limiting middleware in test environments (`NODE_ENV === 'test'`).

---

## 5. Cost Control & External API Modeling
- **Metered API Volume**: Any recurring scheduled task calling paid external APIs (e.g., DataForSEO, Perplexity, OpenAI, Gemini) must have cost modeled at expected scale prior to implementation.
- **Frequency Levers**: Default recurring jobs to conservative frequencies (e.g., weekly instead of daily) unless explicit user requirements state otherwise.

---

## 6. Root-Cause Discipline & Regression Testing
- **Log-Driven Diagnosis**: Trace empirical log tracebacks and reproduce issues before proposing or writing fixes. Avoid superficial symptom patches.
- **Mandatory Regression Tests**: Every bug fix must include a corresponding test case that fails without the fix and passes with it.
- **Explicit Contracts**: Define exact JSON schemas, field names, and explicit validation thresholds for integrations and background workers.
