# Sub2API Reporting Context

This context defines operator-facing reporting language for Sub2API usage analytics and management dashboards.

## Language

**AI Coding Adoption Rate**:
The share of people in a target group who used an AI coding client at least once during the reporting window. This term assumes one API Key represents one person; if keys are shared, use API Key Adoption Rate instead.
_Avoid_: Key coverage, usage penetration, popularity

**Effective AI Coding Usage Rate**:
The share of people in a target group who either made at least 100 AI coding requests or had AI coding usage on at least 5 distinct days during the reporting window.
_Avoid_: Heavy-user rate, real adoption rate

**AI Coding Adoption Stage**:
The neutral status label for a person's AI coding usage in a reporting window: Not Adopted means zero AI coding requests, Light Adoption means at least one request but below the effective-use threshold, and Effective Use means at least 100 requests or at least 5 active AI coding days.
_Avoid_: Low performer, inactive user

**API Key Adoption Rate**:
The share of active, non-deleted API Keys in a target group that show AI coding usage during the reporting window. Use this when API Keys do not reliably map one-to-one to people.
_Avoid_: Employee adoption rate

**AI Coding Usage**:
Usage identified as coming from an AI coding client, primarily by client User-Agent containing Codex or Claude Code, or by a dedicated coding endpoint. Model-name matching is auxiliary display context only and must not be the primary classification rule.
_Avoid_: Codex model usage

**Person Display Name**:
The real person's name shown in internal AI coding adoption reports. For company-group reporting, this name comes from the API Key name because one API Key represents one person.
_Avoid_: User account name, account owner

**Reporting Window**:
The time range used for a usage metric, expressed in the reporting timezone. Operational dashboard metrics use a rolling 30-day window by default; monthly reports and exports may use calendar months.
_Avoid_: Recent period
