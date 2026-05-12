---
name: aws-s3-search
description: |
  Optimize AWS S3 searches and listings.
  Use when finding S3 objects by prefix, path, suffix, pattern, date, size, metadata, tags, versions, or when avoiding slow full-bucket scans.
compatibility: Requires AWS CLI and S3 list/read permissions.
---

# AWS S3 Search Optimization

## Default Strategy

1. Narrow on the server first: bucket, region/profile, `--prefix`, `--delimiter`, `--start-after`, `--max-items`/`--page-size`.
2. Return only needed fields with `s3api` + `--query`; avoid parsing human tables in scripts.
3. Only use client-side filters (`grep`, `jq`, JMESPath predicates) after the smallest practical prefix has been applied.
4. For whole-bucket discovery by suffix/regex/date/size/tags/metadata/encryption/ACL, prefer S3 Inventory, S3 Metadata tables, or Athena over recursive bucket scans.

## Common Patterns

### Known prefix or folder-like path

```bash
aws s3api list-objects-v2 \
  --bucket BUCKET_NAME \
  --prefix "logs/2026/05/" \
  --query 'Contents[].{Key:Key, Size:Size, LastModified:LastModified}' \
  --output table
```

Use `aws s3 ls s3://BUCKET_NAME/logs/2026/05/ --recursive` only for human-readable inspection.

### Browse one hierarchy level

```bash
aws s3api list-objects-v2 \
  --bucket BUCKET_NAME \
  --prefix "logs/" \
  --delimiter "/" \
  --query '{Objects: Contents[].Key, Prefixes: CommonPrefixes[].Prefix}'
```

`--delimiter "/"` rolls up deeper keys into `CommonPrefixes`, avoiding millions of nested results.

### Exact object existence or metadata

```bash
aws s3api head-object --bucket BUCKET_NAME --key "path/to/object.json"
```

Use `head-object` for a known key; do not list the parent prefix just to check existence.

### Filename/suffix/pattern search

S3 only indexes prefixes. If searching for suffixes or substrings, choose the narrowest prefix first:

```bash
aws s3api list-objects-v2 \
  --bucket BUCKET_NAME \
  --prefix "images/2026/" \
  --query "Contents[?ends_with(Key, '.jpg')].Key" \
  --output text
```

Avoid `aws s3 ls s3://BUCKET --recursive | grep pattern` on large buckets unless there is no usable prefix and the bucket is known small.

### Date, size, or storage-class filters

```bash
aws s3api list-objects-v2 \
  --bucket BUCKET_NAME \
  --prefix "exports/" \
  --query "Contents[?LastModified>='2026-05-01T00:00:00+00:00' && Size>`1048576`].[Key,Size,LastModified,StorageClass]" \
  --output table
```

These predicates are client-side in the AWS CLI; they reduce output, not S3 listing work. Use Inventory/Athena for bucket-scale queries.

### Versioned buckets

```bash
aws s3api list-object-versions \
  --bucket BUCKET_NAME \
  --prefix "path/to/key-or-prefix" \
  --query '{Versions: Versions[].{Key:Key,VersionId:VersionId,LastModified:LastModified}, Deletes: DeleteMarkers[].{Key:Key,VersionId:VersionId,LastModified:LastModified}}'
```

Use this for delete markers, previous versions, and recovery investigations.

## Bucket-Scale Search

Use indexed/queryable services instead of repeated `ListObjectsV2` scans when the question is not prefix-shaped:

- **S3 Inventory + Athena**: daily/weekly reports for large or recurring searches by key, size, last modified, storage class, encryption, replication, object lock, ACL, and versions. Prefer Parquet/ORC.
- **S3 Metadata tables**: query current object state and recent changes (often reflected within about an hour) by key, size, tags, user metadata, encryption, requester, and event type.
- **CloudTrail data events / S3 server access logs**: answer access questions such as who read/wrote/deleted an object.
- **S3 Batch Operations**: act on a large search result set from Inventory/Athena instead of scripting per-object loops.

## Do / Avoid

- Do include trailing `/` for folder-like prefixes: `logs/2026/`.
- Do request text/json fields directly: `--query 'Contents[].Key' --output text`.
- Do page intentionally for sampling: `--max-items 100` or `--page-size 1000`.
- Do add `--request-payer requester` for Requester Pays buckets when required.
- Avoid full-bucket recursive list + `grep` for large buckets.
- Avoid one `head-object` or `get-object-tagging` call per listed key unless the result set is already small.
- Avoid assuming S3 prefixes are directories; they are key-name strings.
