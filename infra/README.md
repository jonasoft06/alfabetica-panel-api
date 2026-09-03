# Infrastructure

Configuration files for infrastructure that lives outside the codebase.
These are applied manually — they are not part of any deploy pipeline.

## `spaces-public-read.json`

Bucket policy for the DigitalOcean Spaces bucket `alfabetica-media` (SFO3).
Grants anonymous read (`s3:GetObject`) to everything under the `public/*` prefix.

### Why a bucket policy instead of per-object ACLs

Objects in Spaces are private by default. A bucket policy makes every upload
under `public/` readable without the client having to send an `x-amz-acl`
header on each presigned `PUT` — it keeps the upload flow to a single required
header (`Content-Type`).

### Storage key convention

`storageKey` values are built as `{visibility}/{scope}/{projectId}/{mediaId}.{ext}`:

- `public/portfolio/...`   — portfolio media (covers, galleries)
- `public/publication/...` — publication media
- `private/...`            — reserved for future internal files

Visibility is derived from the scope, not stored as a separate field. Anything
outside `public/` stays private automatically — no extra configuration needed,
since the policy above is the only thing granting anonymous access.

### Applying the policy

Bucket policies **cannot be configured from the DigitalOcean control panel** —
only via the API, `aws-cli` or `s3cmd`.

Requires an `aws-cli` profile pointing at Spaces:

```bash
aws configure set aws_access_key_id "<SPACES_KEY>" --profile spaces
aws configure set aws_secret_access_key "<SPACES_SECRET>" --profile spaces
aws configure set region sfo3 --profile spaces
aws configure set output json --profile spaces
```

Note: Spaces *limited-access keys* are not compatible with bucket policies.
This step needs a full-access key. The backend can keep using a scoped key.

```bash
aws s3api put-bucket-policy \
  --bucket alfabetica-media \
  --policy file://infra/spaces-public-read.json \
  --endpoint-url https://sfo3.digitaloceanspaces.com \
  --profile spaces
```

Verify:

```bash
aws s3api get-bucket-policy \
  --bucket alfabetica-media \
  --endpoint-url https://sfo3.digitaloceanspaces.com \
  --profile spaces
```