---
name: aws-cli
description: |
  AWS CLI integration.
  Use when running AWS CLI commands, parsing AWS CLI output, or preparing JSON input for `aws`.
compatibility: Requires aws cli and jq.
---

## Guidelines

- Prefer structured JSON output when AWS CLI results will be parsed or piped to another tool.
  e.g. `aws ec2 describe-instances --output json | jq '.Reservations[].Instances[].InstanceId'`.
- JSON is the AWS CLI's default output unless the profile/config overrides it. Use `--output json` explicitly in scripts for clarity and stability.
  e.g. `aws s3api list-buckets --output json | jq '.Buckets[].Name'`.
- Use AWS CLI `--query` for server-side-style client filtering with JMESPath before passing output to `jq` when it simplifies the result shape.
  e.g. `aws ec2 describe-instances --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name}' --output json`.
- Prefer JSON plus `jq` over `--output text` when field order or nested data matters.
- For JSON command inputs, prefer files, `--cli-input-json`, or `jq -n` to avoid shell quoting issues.
  e.g. `jq -n --arg name example '{Name:$name}'`.
