// =============================================================================
// region-router additional configuration.
//
// The actual `google_cloud_run_v2_service.region_router` and its serverless
// NEG / backend service are declared in main.tf (next to the other Cloud Run
// services in this module so they share the same lifecycle).
//
// This file holds the policy + IAM that are specific to the region-router
// service, kept separate so they are easy to find and audit.
// =============================================================================

// IAM: only the global LB invoker (allUsers via Cloud Armor) hits the router.
// We keep ingress = INTERNAL_LOAD_BALANCER on the service itself so direct
// run.app calls return 403; the LB is the only valid invoker.
resource "google_cloud_run_v2_service_iam_member" "region_router_lb_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.region_router.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

// Health-check log-based metric so the SLO can watch 302 vs 5xx ratios on the
// region-router specifically.
resource "google_logging_metric" "region_router_redirects" {
  project = var.project_id
  name    = "${local.service_prefix}-region-router-redirects"
  filter = join(" ", [
    "resource.type=\"cloud_run_revision\"",
    "AND resource.labels.service_name=\"${google_cloud_run_v2_service.region_router.name}\"",
    "AND httpRequest.status>=300",
    "AND httpRequest.status<400",
  ])
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "VSBS region-router 3xx redirects (${var.region})"
  }
}
