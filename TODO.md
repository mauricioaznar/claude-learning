# TODO

Cross-project reminders that don't belong in any single project's CLAUDE.md.

- [ ] **Delete the real S3 bucket after the `s3-presigned-post-uploads-express-vs-nest` lab is finished.**
  When the lab is repointed from MinIO to real AWS, it creates a live bucket
  (planned name: `inopack-s3lab-uploads-dev`). Once the lab wraps, delete the
  bucket and its objects so it stops incurring storage charges — dev MinIO leaves
  nothing behind, but a real bucket does.
