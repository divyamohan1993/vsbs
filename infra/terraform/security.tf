// =============================================================================
// VSBS — Security baseline.
//
// Resources:
//   1. Cloud Armor security policy (OWASP CRS 4.x preconfigured rules + per-IP
//      rate limit) — attached at the load balancer in front of Cloud Run.
//   2. reCAPTCHA Enterprise key for high-risk endpoints (auth + auto-pay).
//   3. Binary Authorization policy + Sigstore attestor — only signed images
//      may run on Cloud Run in staging and prod.
//   4. VPC Service Controls perimeter for the asia-south1 production data
//      plane: Firestore + AlloyDB + Cloud Storage + Vertex AI + KMS.
//
// References:
//   docs/research/security.md §5 (zero trust on GCP)
//   docs/research/security.md §6 (HTTP security headers baseline)
//   docs/security/threat-model.md, docs/security/keys.md
//
// Inputs come from variables.tf + per-environment tfvars. Resources gated
// behind `var.enable_*` toggles so the skeleton applies cleanly in dev.
// =============================================================================

variable "enable_cloud_armor" {
  type        = bool
  default     = true
  description = "When true, provisions the Cloud Armor edge policy."
}

variable "enable_binary_authorization" {
  type        = bool
  default     = false
  description = "When true, provisions the Binary Authorization policy + attestor (requires KMS + Container Analysis APIs)."
}

variable "enable_vpc_service_controls" {
  type        = bool
  default     = false
  description = "When true, provisions the VPC-SC perimeter (requires access-context-manager API + organisation policy admin)."
}

variable "vpc_sc_access_policy_name" {
  type        = string
  default     = ""
  description = "Existing Access Context Manager policy name (organisations/X/accessPolicies/Y). Empty when VPC-SC disabled."
}

variable "binary_authorization_attestor_email" {
  type        = string
  default     = ""
  description = "Service account email allowed to sign attestations for Binary Authorization."
}

variable "recaptcha_display_name" {
  type        = string
  default     = "VSBS auth + auto-pay"
}

// -----------------------------------------------------------------------------
// 1. Cloud Armor — OWASP CRS 4.x + per-IP rate limit + reCAPTCHA challenge
// -----------------------------------------------------------------------------

resource "google_compute_security_policy" "edge" {
  count       = var.enable_cloud_armor ? 1 : 0
  name        = "vsbs-edge-policy"
  description = "VSBS edge: OWASP CRS 4.x + per-IP sliding-window rate limit + auth-path reCAPTCHA challenge."
  type        = "CLOUD_ARMOR"

  // ---- OWASP CRS 4.x preconfigured rules (sensitivity 1) ----
  rule {
    action   = "deny(403)"
    priority = 1000
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — SQL injection"
  }
  rule {
    action   = "deny(403)"
    priority = 1100
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Cross-site scripting"
  }
  rule {
    action   = "deny(403)"
    priority = 1200
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('lfi-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Local file inclusion"
  }
  rule {
    action   = "deny(403)"
    priority = 1300
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('rce-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Remote code execution"
  }
  rule {
    action   = "deny(403)"
    priority = 1400
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('rfi-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Remote file inclusion"
  }
  rule {
    action   = "deny(403)"
    priority = 1500
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('scannerdetection-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Scanner detection"
  }
  rule {
    action   = "deny(403)"
    priority = 1600
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('protocolattack-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Protocol attack"
  }
  rule {
    action   = "deny(403)"
    priority = 1700
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sessionfixation-v33-stable', {'sensitivity': 1})"
      }
    }
    description = "OWASP CRS 4.x — Session fixation"
  }

  // ---- Adaptive per-IP rate limit (10 r/s, ban at 200/min) ----
  rule {
    action   = "rate_based_ban"
    priority = 2000
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 200
        interval_sec = 60
      }
      ban_duration_sec = 600
      ban_threshold {
        count        = 1000
        interval_sec = 600
      }
    }
    description = "Per-IP sliding-window rate limit"
  }

  // ---- Adaptive Protection (auto-ban during DDoS) ----
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable          = true
      rule_visibility = "STANDARD"
    }
  }

  // ---- Default allow ----
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    description = "Default rule: allow"
  }
}

// -----------------------------------------------------------------------------
// 2. reCAPTCHA Enterprise — keys for the auth and auto-pay paths.
// -----------------------------------------------------------------------------

resource "google_recaptcha_enterprise_key" "auth_paths" {
  display_name = var.recaptcha_display_name
  project      = var.project_id

  web_settings {
    integration_type              = "SCORE"
    allow_all_domains             = false
    allowed_domains               = ["vsbs.app", "${var.domain_root}"]
    challenge_security_preference = "USABILITY"
  }

  labels = {
    purpose = "auth-and-autopay"
  }
}

// -----------------------------------------------------------------------------
// 3. Binary Authorization — Sigstore attestor + policy.
// -----------------------------------------------------------------------------

resource "google_binary_authorization_attestor" "vsbs_release" {
  count   = var.enable_binary_authorization ? 1 : 0
  name    = "vsbs-release"
  project = var.project_id

  attestation_authority_note {
    note_reference = google_container_analysis_note.vsbs_release[0].name
  }

  description = "Sigstore attestor for the VSBS release pipeline."
}

resource "google_container_analysis_note" "vsbs_release" {
  count   = var.enable_binary_authorization ? 1 : 0
  name    = "vsbs-release-note"
  project = var.project_id

  attestation_authority {
    hint {
      human_readable_name = "VSBS Sigstore release attestor"
    }
  }
}

resource "google_binary_authorization_policy" "vsbs" {
  count   = var.enable_binary_authorization ? 1 : 0
  project = var.project_id

  default_admission_rule {
    evaluation_mode  = "REQUIRE_ATTESTATION"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = [
      google_binary_authorization_attestor.vsbs_release[0].name,
    ]
  }

  // Cloud Run staging: same attestation rule.
  cluster_admission_rules {
    cluster                 = "${var.region}.staging"
    evaluation_mode         = "REQUIRE_ATTESTATION"
    enforcement_mode        = "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = [google_binary_authorization_attestor.vsbs_release[0].name]
  }

  // Cloud Run prod: same rule, plus dryrun for early signal.
  cluster_admission_rules {
    cluster                 = "${var.region}.prod"
    evaluation_mode         = "REQUIRE_ATTESTATION"
    enforcement_mode        = "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = [google_binary_authorization_attestor.vsbs_release[0].name]
  }

  global_policy_evaluation_mode = "ENABLE"
}

// -----------------------------------------------------------------------------
// 4. VPC Service Controls — asia-south1 prod data plane.
// -----------------------------------------------------------------------------

resource "google_access_context_manager_service_perimeter" "vsbs_prod_asia_south1" {
  count          = var.enable_vpc_service_controls ? 1 : 0
  parent         = var.vpc_sc_access_policy_name
  name           = "${var.vpc_sc_access_policy_name}/servicePerimeters/vsbs_prod_asia_south1"
  title          = "VSBS prod asia-south1 perimeter"
  perimeter_type = "PERIMETER_TYPE_REGULAR"

  status {
    restricted_services = [
      "firestore.googleapis.com",
      "alloydb.googleapis.com",
      "storage.googleapis.com",
      "aiplatform.googleapis.com",
      "cloudkms.googleapis.com",
      "secretmanager.googleapis.com",
      "bigquery.googleapis.com",
      "pubsub.googleapis.com",
    ]
    resources = ["projects/${var.project_id}"]

    vpc_accessible_services {
      enable_restriction = true
      allowed_services   = ["RESTRICTED-SERVICES"]
    }
  }
}

// -----------------------------------------------------------------------------
// Outputs — wire these into the Cloud Run + load-balancer modules.
// -----------------------------------------------------------------------------

output "edge_security_policy_id" {
  value       = var.enable_cloud_armor ? google_compute_security_policy.edge[0].id : null
  description = "Cloud Armor security policy id (attach to backend service)."
}

output "recaptcha_key_id" {
  value       = google_recaptcha_enterprise_key.auth_paths.id
  description = "reCAPTCHA Enterprise key id for auth + auto-pay endpoints."
}

output "binary_authorization_attestor_id" {
  value       = var.enable_binary_authorization ? google_binary_authorization_attestor.vsbs_release[0].name : null
  description = "Binary Authorization attestor name."
}
