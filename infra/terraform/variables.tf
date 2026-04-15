variable "project_id" {
  type        = string
  description = "GCP project id for VSBS deployments."
}

variable "region" {
  type        = string
  default     = "asia-south1"
  description = "Primary region. Must match data-residency commitments (DPDP)."
}

variable "firestore_location" {
  type        = string
  default     = "asia-south1"
  description = "Firestore location id. India-resident by default."
}

variable "api_image" {
  type        = string
  description = "Full image URI for the API (Artifact Registry)."
}

variable "web_image" {
  type        = string
  description = "Full image URI for the web app (Artifact Registry)."
}
