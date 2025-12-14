# GitHub Actions Workflows

This directory contains GitHub Actions workflows that ensure code quality and security before merging to main.

## Workflows

### 1. Go CI (`go-ci.yml`)
Validates Go code quality and functionality:
- **Lint**: Checks code formatting with `go fmt` and runs `go vet`
- **Build**: Ensures the application compiles successfully
- **Test**: Runs all unit tests

**Triggers**: Pull requests and pushes to main that affect Go files

### 2. Docker Build Check (`docker-build-check.yml`)
Validates that the Docker image builds successfully:
- Builds the Docker image without pushing
- Uses build cache for efficiency

**Triggers**: Pull requests and pushes to main that affect status-app files

### 3. Pull Request Checks (`pr-checks.yml`)
Validates pull request quality:
- **PR Title Validation**: Ensures descriptive titles (minimum 10 characters)
- **Merge Conflict Detection**: Checks for conflicts with base branch
- **File Change Validation**: Verifies that files were actually changed
- **Security Check**: Runs gosec security scanner on Go code

**Triggers**: Pull request events (opened, synchronized, reopened)

### 4. Status Check (`status-check.yml`)
Provides a summary of all required checks:
- Documents all required status checks
- Generates a summary report

**Triggers**: Pull requests to main

## Required Checks for Merging

To merge a pull request to main, the following checks must pass:

1. ✅ **Go Lint** - Code must be properly formatted and pass vet
2. ✅ **Go Build** - Application must compile successfully
3. ✅ **Go Test** - All tests must pass
4. ✅ **Docker Build** - Docker image must build without errors
5. ✅ **PR Validation** - PR must have descriptive title and no conflicts
6. ✅ **Security Check** - No critical security vulnerabilities

## Setting Up Branch Protection

To enforce these checks, configure branch protection rules in GitHub:

1. Go to repository **Settings** → **Branches**
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select the following status checks:
   - `Lint`
   - `Build`
   - `Test`
   - `Build Docker Image`
   - `Validate PR`
   - `Security Check`
5. Enable "Require branches to be up to date before merging"
6. Save the protection rule

## Local Development

Before pushing code, you can run these checks locally:

```bash
# Format check
cd status-app && gofmt -l .

# Vet check
cd status-app && go vet ./...

# Build check
cd status-app && go build ./...

# Run tests
cd status-app && go test ./...

# Docker build check
cd status-app && docker build -f deploy/Dockerfile -t servicarr:test .
```
