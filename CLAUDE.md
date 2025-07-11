# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the `arch` repository - a personal infrastructure management project using Terraform and TFAction for declarative infrastructure-as-code across multiple cloud providers (AWS, Cloudflare, GCP). It manages the infrastructure foundation that supports a companion Kubernetes repository called `lolice`.

## Key Commands

### Tool Management (Aqua)
- `aqua install` - Install all required tools for the project
- `aqua list` - List all available tools and versions
- Tools are managed globally at project root and per-directory via `aqua/aqua.yaml` files

### Terraform Operations
- **Navigate to specific terraform directory first** (e.g., `cd terraform/aws/users/` or `cd terraform/cloudflare/b0xp.io/k8s/`)
- `terraform init` - Initialize terraform in a working directory
- `terraform plan` - Plan terraform changes
- `terraform apply` - Apply terraform changes
- `terraform validate` - Validate terraform configuration
- `terraform fmt` - Format terraform files

### Linting and Validation
- `tflint` - Lint terraform files (run from terraform working directories)
- `conftest verify --policy policy/terraform` - Validate against OPA policies
- `trivy config .` - Security scanning of terraform configurations
- `actionlint` - Lint GitHub Actions workflows
- `ghalint run` - GitHub Actions workflow linting

### TFAction Workflows
- TFAction automatically handles terraform operations via GitHub Actions
- Uses `tfaction-root.yaml` for global configuration
- Each terraform directory has its own `tfaction.yaml` for specific settings
- Supports automated plan/apply workflows with proper IAM role assumptions

## Architecture

### Project Structure
- **`terraform/`** - Main terraform configurations organized by provider
  - `aws/` - AWS resources (IAM, ECR, SSM Parameter Store, etc.)
  - `cloudflare/` - Cloudflare resources (DNS, tunnels, access policies)
  - Two domains managed: `b0xp.io` and `boxp.tk`
- **`policy/terraform/`** - Open Policy Agent (OPA) policies for governance
- **`templates/`** - Terraform module templates for new components
- **`aqua/`** - Tool dependency management configuration

### Technology Stack
- **Terraform** - Infrastructure as Code
- **TFAction** - Terraform automation via GitHub Actions
- **Aqua** - Tool version management
- **Open Policy Agent** - Policy enforcement
- **AWS** - Cloud services (primarily IAM, ECR, SSM)
- **Cloudflare** - DNS, tunnels, and access management
- **Renovate** - Automated dependency updates

### Relationship with `lolice` Project
The `arch` project provides the infrastructure foundation that the `lolice` Kubernetes repository builds upon:
- `arch` defines cloud resources, DNS, tunnels, and access policies
- `lolice` deploys applications on the Kubernetes cluster using the infrastructure
- Secrets managed in AWS SSM Parameter Store (arch) are consumed by External Secrets in `lolice`
- Cloudflare tunnels defined in `arch` provide secure external access to `lolice` services

### TFAction CI/CD Flow
1. Changes to terraform files trigger GitHub Actions
2. `terraform plan` runs automatically on PRs
3. After approval and merge, `terraform apply` runs automatically
4. State is stored in S3 with proper IAM role assumptions
5. Policies are enforced via OPA conftest during validation

### Security & Compliance
- All terraform providers are explicitly whitelisted in CI/CD
- OPA policies enforce naming conventions and security standards
- AWS IAM roles with least-privilege for GitHub Actions
- Secrets management via AWS SSM Parameter Store
- Regular dependency updates via Renovate

## Important Notes

### Working with Terraform
- Always run terraform commands from the appropriate working directory
- Each terraform directory is independently managed with its own state
- Use `aqua install` to ensure you have the correct tool versions
- Policy validation runs automatically but can be tested locally with conftest

### Adding New Infrastructure
1. Use templates from `templates/` directory as starting point
2. Follow existing naming conventions and directory structure
3. Ensure new terraform providers are added to the approved whitelist
4. Test with `terraform plan` before creating PR

### Cursor Rules Integration
The repository includes Cursor IDE rules that require reading project documentation files before task execution:
- `@doc/project-structure.md` - Detailed directory structure
- `@doc/project-spec.md` - Complete project specifications and workflows