# S3-hosted OIDC Discovery for the lolice kubeadm cluster.
#
# Tailscale Workload Identity Federation requires the OIDC issuer to be
# publicly accessible.  Since the lolice API server lives on a private
# network, we publish the two required discovery documents in an S3
# bucket with public-read access.
#
# After the first apply, upload the real JWKS by extracting the SA
# signing public key from a control-plane node:
#
#   kubectl get --raw /openid/v1/jwks > /tmp/jwks.json
#   aws s3 cp /tmp/jwks.json s3://lolice-k8s-oidc/openid/v1/jwks \
#     --content-type application/json
#
# Then update the variable k8s_sa_jwks_json with the real content so
# that future applies do not overwrite it.

# ── S3 bucket ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "k8s_oidc" {
  bucket = "lolice-k8s-oidc"
}

resource "aws_s3_bucket_public_access_block" "k8s_oidc" {
  bucket = aws_s3_bucket.k8s_oidc.id

  # Allow public read via bucket policy (required for OIDC discovery).
  block_public_acls  = true
  ignore_public_acls = true

  # Public policy and buckets must be allowed so Tailscale can fetch the
  # OIDC discovery documents without authentication.
  block_public_policy     = false #trivy:ignore:AVD-AWS-0087 -- intentional: OIDC discovery must be public
  restrict_public_buckets = false #trivy:ignore:AVD-AWS-0093 -- intentional: OIDC discovery must be public
}

resource "aws_s3_bucket_policy" "k8s_oidc_public_read" {
  bucket = aws_s3_bucket.k8s_oidc.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowPublicReadOIDC"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource = [
          "${aws_s3_bucket.k8s_oidc.arn}/.well-known/openid-configuration",
          "${aws_s3_bucket.k8s_oidc.arn}/openid/v1/jwks",
        ]
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.k8s_oidc]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "k8s_oidc" {
  bucket = aws_s3_bucket.k8s_oidc.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── OIDC Discovery document ─────────────────────────────────────────

locals {
  oidc_issuer_url = "https://${aws_s3_bucket.k8s_oidc.bucket_regional_domain_name}"
}

resource "aws_s3_object" "oidc_discovery" {
  bucket       = aws_s3_bucket.k8s_oidc.id
  key          = ".well-known/openid-configuration"
  content_type = "application/json"

  content = jsonencode({
    issuer                                = local.oidc_issuer_url
    jwks_uri                              = "${local.oidc_issuer_url}/openid/v1/jwks"
    response_types_supported              = ["id_token"]
    subject_types_supported               = ["public"]
    id_token_signing_alg_values_supported = ["RS256"]
  })
}

# ── JWKS document ────────────────────────────────────────────────────
# The initial content is a placeholder.  Replace with the real JWKS
# extracted from the cluster (see header comment).

resource "aws_s3_object" "oidc_jwks" {
  bucket       = aws_s3_bucket.k8s_oidc.id
  key          = "openid/v1/jwks"
  content_type = "application/json"
  content      = var.k8s_sa_jwks_json

  lifecycle {
    ignore_changes = [content]
  }
}
