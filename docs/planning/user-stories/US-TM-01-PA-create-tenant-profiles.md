---
id: US-TM-01
title: Platform Administrator - Create Tenant Profiles
module: tm
status: canonical
priority: High
effort: 5
personas: [PlatformAdmin]
linked_mfu: []
linked_epic: 
non_functional: [Performance, Security, Reliability]
---

## Story

As a **platform administrator**, I want to **create and configure new tenant profiles**,  
so that I can **onboard partner consultancies to the platform with their own isolated environment and branding**.

## Business Value

Enables the platform to support multiple consultancies as isolated tenants, allowing each partner to have their own branded instance while maintaining data isolation and security.

## Preconditions

- User authenticated and has platform administrator role
- Platform tenant management feature enabled
- System has sufficient capacity for new tenant

## Acceptance Criteria (Gherkin format)

1. **Given** I am a platform administrator, **when** I navigate to the tenant management page, **then** I see a form to create a new tenant with required fields.
2. **Given** I complete the tenant creation form with valid data (name, slug, primary contact), **when** I submit the form, **then** a new tenant record is created in the database.
3. **Given** a new tenant is created, **when** the system processes the creation, **then** a default tenant configuration record is automatically generated.
4. **Given** a new tenant is created, **when** the system processes the creation, **then** a default subdomain is generated based on the tenant slug.
5. **Given** a new tenant is created, **when** the system processes the creation, **then** an initial admin user is provisioned based on the primary contact information.
6. **Given** I am viewing the tenant list, **when** I access it, **then** I see all tenants with status indicators, creation date, last activity, and user count.
7. **Given** I am viewing the tenant list, **when** I use search and filter controls, **then** the list is filtered according to my criteria.
8. **Given** I select a tenant, **when** I view its details, **then** I see all configuration, domains, and associated users.
9. **Given** a tenant is being created, **when** partial record creation fails, **then** rollback logic ensures no orphaned data is left.
10. **Given** I create a tenant with a slug already used across environments, **when** validation occurs, **then** I am prompted to choose a unique slug.

## Definition of Done

- All ACs implemented and passing automated tests
- Code merged to `main` and deployed to staging
- API documentation updated
- UI documentation updated
- Tenant isolation verified through testing
- Rollback logic verified for failed creation
- Search and filter functionality tested with various criteria
- Error handling for duplicate slugs and invalid data
- Cross-reference tested with branding story (US-TM-03)

## States

`Trial → Active → Inactive`

## Test Mapping

| ID | Scenario | Type | Expected Result |
|----|----------|------|-----------------|
| TC-TM-01-1 | Create tenant with valid data | Integration | Tenant record created with all related records |
| TC-TM-01-2 | Create tenant with duplicate slug | Unit | Validation error returned |
| TC-TM-01-3 | Create tenant with invalid slug format | Unit | Validation error returned |
| TC-TM-01-4 | View tenant list | E2E | All tenants displayed with correct metadata |
| TC-TM-01-5 | Search tenants by name | Integration | Filtered results returned |
| TC-TM-01-6 | Verify rollback logic | Integration | No partial data remains |
| TC-TM-01-7 | Verify tenant isolation | E2E | Users can only access their tenant data |

## Notes

- Tenant slug must be validated to ensure it works as a subdomain (alphanumeric with hyphens only)
- Theme and logo customisation managed under US-TM-03
- Add database indexes for tenant ID and slug for query performance
- Use transactional safety to avoid partial record creation
