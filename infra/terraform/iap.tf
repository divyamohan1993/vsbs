// =============================================================================
// VSBS — Cloud IAP for /admin paths.
//
// The brand and OAuth2 client live at the ROOT level (not inside `global/`)
// because the per-region modules need to reference the client id/secret on
// their `google_compute_backend_service.api_admin` `iap{}` block. Putting
// the brand/client in `global/` would create a circular dependency (global
// already consumes the region backend ids; region would also have to consume
// global's IAP outputs).
//
// Resources:
//   - google_iap_brand "vsbs"     — project-wide internal brand. Created once
//                                   per project. The support email must be a
//                                   group or owner-role member; supplied via
//                                   `var.iap_support_email`.
//   - google_iap_client "admin"   — OAuth2 client used by Cloud IAP to mint
//                                   the `x-goog-iap-jwt-assertion` header on
//                                   authenticated requests.
//   - google_iap_web_backend_service_iam_binding x 2
//                                  — grants `iap.httpsResourceAccessor` on
//                                   each region's IAP-protected admin backend
//                                   to `var.iap_admin_members` (group, user,
//                                   serviceAccount).
//
// References:
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iap_brand
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iap_client
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iap_web_backend_service_iam
//   https://cloud.google.com/iap/docs/load-balancer-howto
// =============================================================================

variable "iap_support_email" {
  type        = string
  description = "Support email shown on the IAP consent screen. Must be a group address or a project owner."
}

variable "iap_admin_members" {
  type        = list(string)
  default     = []
  description = "IAM principals (e.g. user:..., group:..., serviceAccount:...) granted iap.httpsResourceAccessor on the admin backends."
}

// NOTE: `google_iap_brand` and `google_iap_client` were marked deprecated by
// Google in July 2025 (the IAP OAuth Admin API is being retired). For the
// short term these still work and are the only TF-native way to provision
// the consent screen. Production operators should:
//   1. Create the brand once via the Google Cloud Console (Internal type).
//   2. `terraform import google_iap_brand.vsbs projects/<PROJECT_NUM>/brands/<BRAND_ID>`
//   3. Continue using `google_iap_client.admin` (also deprecated but
//      functional) to mint the OAuth client this module references.
// When Google ships a replacement resource, swap both blocks; the Cloud Run
// + backend wiring downstream is unaffected.
resource "google_iap_brand" "vsbs" {
  project           = var.project_id
  support_email     = var.iap_support_email
  application_title = "VSBS Admin"

  depends_on = [google_project_service.enabled]
}

resource "google_iap_client" "admin" {
  display_name = "VSBS Admin OAuth Client"
  brand        = google_iap_brand.vsbs.name
}

// Grant chosen members access on the India admin backend.
resource "google_iap_web_backend_service_iam_binding" "admin_in" {
  count               = length(var.iap_admin_members) > 0 ? 1 : 0
  project             = var.project_id
  web_backend_service = module.india.api_admin_backend_service_name
  role                = "roles/iap.httpsResourceAccessor"
  members             = var.iap_admin_members
}

resource "google_iap_web_backend_service_iam_binding" "admin_us" {
  count               = length(var.iap_admin_members) > 0 ? 1 : 0
  project             = var.project_id
  web_backend_service = module.us.api_admin_backend_service_name
  role                = "roles/iap.httpsResourceAccessor"
  members             = var.iap_admin_members
}

output "iap_admin_client_id" {
  value       = google_iap_client.admin.client_id
  description = "OAuth2 client id used by Cloud IAP on the admin backend services."
}

output "iap_admin_client_secret" {
  value       = google_iap_client.admin.secret
  description = "OAuth2 client secret used by Cloud IAP on the admin backend services."
  sensitive   = true
}

// The audience the API must verify on `x-goog-iap-jwt-assertion`. IAP signs
// tokens with `aud = /projects/<num>/global/backendServices/<id>`. We surface
// the per-region audience strings so each Cloud Run env can pin to its own.
output "iap_audience_in" {
  value       = "/projects/${data.google_project.current.number}/global/backendServices/${module.india.api_admin_backend_service_id_short}"
  description = "GCP_IAP_AUDIENCE the India API verifies on inbound IAP assertions."
}

output "iap_audience_us" {
  value       = "/projects/${data.google_project.current.number}/global/backendServices/${module.us.api_admin_backend_service_id_short}"
  description = "GCP_IAP_AUDIENCE the US API verifies on inbound IAP assertions."
}

data "google_project" "current" {
  project_id = var.project_id
}
