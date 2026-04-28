// Outputs the per-region module exposes back to the root and to the global
// load balancer module.

output "region" {
  value       = var.region
  description = "Full region id."
}

output "region_short" {
  value       = var.region_short
  description = "Short slug for this region."
}

output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Cloud Run uri for the API service in this region."
}

output "web_url" {
  value       = google_cloud_run_v2_service.web.uri
  description = "Cloud Run uri for the web service in this region."
}

output "region_router_url" {
  value       = google_cloud_run_v2_service.region_router.uri
  description = "Cloud Run uri for the region-router service in this region."
}

output "firestore_id" {
  value       = google_firestore_database.default.id
  description = "Firestore database resource id."
}

output "firestore_name" {
  value       = google_firestore_database.default.name
  description = "Firestore database short name."
}

output "artifact_registry_id" {
  value       = google_artifact_registry_repository.containers.id
  description = "Artifact Registry repo id."
}

output "api_backend_service_id" {
  value       = google_compute_backend_service.api.id
  description = "Backend service id for the regional API NEG (consumed by the global URL map)."
}

output "web_backend_service_id" {
  value       = google_compute_backend_service.web.id
  description = "Backend service id for the regional web NEG."
}

output "region_router_backend_service_id" {
  value       = google_compute_backend_service.region_router.id
  description = "Backend service id for the regional region-router NEG."
}

output "logging_sink_writer_identity" {
  value       = google_logging_project_sink.regional.writer_identity
  description = "Service account identity that writes to the central BigQuery dataset; root grants it the dataEditor role on the dataset."
}

output "secret_ids" {
  value = {
    anthropic_key                 = google_secret_manager_secret.anthropic_key.id
    maps_server_key               = google_secret_manager_secret.maps_server_key.id
    smartcar_secret               = google_secret_manager_secret.smartcar_secret.id
    identity_platform_signing_key = google_secret_manager_secret.identity_platform_signing_key.id
  }
  description = "Map of secret resource ids by purpose."
}
