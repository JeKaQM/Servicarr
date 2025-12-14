# Branch Protection Configuration

This document describes how to configure branch protection rules to enforce the GitHub Actions checks before merging.

## Required Status Checks

The following GitHub Actions workflows have been configured to run on pull requests:

### 1. Go CI Checks (`go-ci.yml`)
- **Lint** - Ensures code is properly formatted (`go fmt`) and passes static analysis (`go vet`)
- **Build** - Verifies the application compiles successfully
- **Test** - Runs all unit tests

### 2. Docker Build Check (`docker-build-check.yml`)
- **Build Docker Image** - Ensures the Docker image builds successfully

### 3. Pull Request Checks (`pr-checks.yml`)
- **Validate PR** - Checks PR title length and validates file changes
- **Security Check** - Runs gosec security scanner

### 4. Status Check (`status-check.yml`)
- **All Checks Status** - Provides a summary of required checks

## Setting Up Branch Protection Rules

To enforce these checks before merging, follow these steps:

1. **Navigate to Repository Settings**
   - Go to your repository on GitHub
   - Click on **Settings** → **Branches**

2. **Add Branch Protection Rule**
   - Click **Add rule** or **Add branch protection rule**
   - For "Branch name pattern", enter: `main`

3. **Configure Protection Settings**
   
   Enable the following options:
   
   - ✅ **Require a pull request before merging**
     - Number of approvals required: 1 (recommended)
   
   - ✅ **Require status checks to pass before merging**
     - ✅ **Require branches to be up to date before merging**
     - Search and select these status checks:
       - `Lint`
       - `Build`
       - `Test`
       - `Build Docker Image`
       - `Validate PR`
   
   - ✅ **Do not allow bypassing the above settings** (recommended for team repositories)

4. **Save Changes**
   - Click **Create** or **Save changes**

## Additional Recommended Settings

For enhanced security and code quality:

- ✅ **Require signed commits** - Ensures commits are verified
- ✅ **Include administrators** - Applies rules to repository administrators
- ✅ **Restrict who can push to matching branches** - Limit merge permissions

## Fixing Code Before Merging

If the CI checks fail, here's how to fix common issues:

### Go Formatting Issues
```bash
cd status-app
gofmt -w .
git add .
git commit -m "Fix code formatting"
git push
```

### Go Vet Issues
```bash
cd status-app
go vet ./...
# Fix reported issues
git add .
git commit -m "Fix vet issues"
git push
```

### Build Failures
```bash
cd status-app
go build ./...
# Fix compilation errors
git add .
git commit -m "Fix build issues"
git push
```

### Docker Build Issues
```bash
cd status-app
docker build -f deploy/Dockerfile -t servicarr:test .
# Fix Dockerfile or code issues
git add .
git commit -m "Fix docker build"
git push
```

## Testing Checks Locally

Before pushing, run these commands to test locally:

```bash
# Navigate to project
cd status-app

# Run all checks
gofmt -l . && \
go vet ./... && \
go build ./... && \
go test ./... && \
docker build -f deploy/Dockerfile -t servicarr:test .

# If all pass, you're good to push!
```

## Workflow Triggers

The workflows are triggered on:
- **Pull Requests** to `main` branch
- **Pushes** to `main` branch (post-merge validation)

This ensures code quality is maintained at all times.

## Notes

- The security check workflow uses `gosec` to scan for common security issues in Go code
- All workflows use caching to speed up subsequent runs
- Workflows only run when relevant files are changed (path filters are configured)
