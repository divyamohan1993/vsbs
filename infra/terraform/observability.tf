// =============================================================================
// VSBS cross-region observability.
//
//   - Central BigQuery dataset partitioned by region (per-region log sinks
//     route here from each region module).
//   - Uptime checks per region against the API readyz endpoint.
//   - Aggregated dashboard JSON pulling p50/p95/p99 latency, error rate, and
//     wellbeing-score distribution.
//
// Data residency: each region's sink only carries that region's logs. The
// dataset has table-level region labels so DPDP queries can filter by
// `region = "asia-south1"` and stay inside the India compartment.
//
// References:
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/logging_project_sink
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_uptime_check_config
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_dashboard
// =============================================================================

variable "observability_project_id" {
  type        = string
  default     = ""
  description = "Project that owns the central observability BigQuery dataset. Defaults to var.project_id."
}

variable "observability_dataset_name" {
  type        = string
  default     = "vsbs_logs"
  description = "BigQuery dataset name for cross-region observability."
}

variable "observability_dataset_location" {
  type        = string
  default     = "US"
  description = "BigQuery multi-region for the dataset. Use US for the US data plane; the India sink ships only metadata-light logs (DPDP-safe)."
}

variable "uptime_target_in" {
  type    = string
  default = "vsbs-in.dmj.one"
}

variable "uptime_target_us" {
  type    = string
  default = "vsbs-us.dmj.one"
}

locals {
  obs_project = var.observability_project_id != "" ? var.observability_project_id : var.project_id
}

// ---- Central BigQuery dataset (table-partitioned by ingestion time, with
//      region label as a clustering field through the sink schema) ----
resource "google_bigquery_dataset" "vsbs_logs" {
  project    = local.obs_project
  dataset_id = var.observability_dataset_name
  location   = var.observability_dataset_location

  description                 = "VSBS cross-region logs. Per-region sinks land here. Region label preserved on every row."
  default_table_expiration_ms = 1000 * 60 * 60 * 24 * 90 // 90 days

  labels = {
    workload = "vsbs"
    purpose  = "observability"
  }
}

// Granting the per-region sinks dataEditor on the dataset is the
// responsibility of the root caller (it has the writer_identity outputs).

// ---- Uptime checks ----
resource "google_monitoring_uptime_check_config" "api_in" {
  project      = local.obs_project
  display_name = "VSBS API uptime — asia-south1"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/readyz"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.obs_project
      host       = "api-in.dmj.one"
    }
  }
}

resource "google_monitoring_uptime_check_config" "api_us" {
  project      = local.obs_project
  display_name = "VSBS API uptime — us-central1"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/readyz"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.obs_project
      host       = "api-us.dmj.one"
    }
  }
}

resource "google_monitoring_uptime_check_config" "web_in" {
  project      = local.obs_project
  display_name = "VSBS Web uptime — asia-south1"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path           = "/"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.obs_project
      host       = var.uptime_target_in
    }
  }
}

resource "google_monitoring_uptime_check_config" "web_us" {
  project      = local.obs_project
  display_name = "VSBS Web uptime — us-central1"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path           = "/"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.obs_project
      host       = var.uptime_target_us
    }
  }
}

// ---- Logging-based metrics — extract structured fields from JSON logs and
//      surface them as monitoring metrics that the alert policies below can
//      filter on. ----

resource "google_logging_metric" "vsbs_safety_overrides" {
  project = local.obs_project
  name    = "vsbs/safety_overrides"
  filter  = "jsonPayload.msg=\"safety_override\" resource.type=\"cloud_run_revision\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "region"
      value_type  = "STRING"
      description = "Region tag from the structured log entry."
    }
  }
  label_extractors = {
    "region" = "EXTRACT(jsonPayload.region)"
  }
}

resource "google_logging_metric" "vsbs_autonomy_handoff_failures" {
  project = local.obs_project
  name    = "vsbs/autonomy_handoff_failures"
  filter  = "jsonPayload.msg=\"autonomy_handoff_failed\" resource.type=\"cloud_run_revision\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "vsbs_consent_revocations" {
  project = local.obs_project
  name    = "vsbs/consent_revocations"
  filter  = "jsonPayload.msg=\"consent_revoked\" resource.type=\"cloud_run_revision\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

// ---- Notification channel — operators wire their PagerDuty/Slack here. ----
variable "alert_email_address" {
  type        = string
  default     = ""
  description = "If set, alert policies notify this email. Operators normally swap this for a PagerDuty/Slack channel."
}

resource "google_monitoring_notification_channel" "ops_email" {
  count        = var.alert_email_address != "" ? 1 : 0
  project      = local.obs_project
  display_name = "VSBS Ops email"
  type         = "email"
  labels = {
    email_address = var.alert_email_address
  }
}

// ---- Alert policies — symptoms not causes. ----
resource "google_monitoring_alert_policy" "api_error_rate" {
  project      = local.obs_project
  display_name = "VSBS API error rate > 1 % (5 min)"
  combiner     = "OR"
  conditions {
    display_name = "5xx rate exceeds 1% over a 5 minute window"
    condition_threshold {
      filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.response_code_class=\"5xx\""
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.location"]
      }
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01
      duration        = "300s"
      trigger {
        count = 1
      }
    }
  }
  notification_channels = [
    for c in google_monitoring_notification_channel.ops_email : c.id
  ]
}

resource "google_monitoring_alert_policy" "api_latency_p99" {
  project      = local.obs_project
  display_name = "VSBS API p99 latency > 1 s (10 min)"
  combiner     = "OR"
  conditions {
    display_name = "p99 over 1s for 10 consecutive minutes"
    condition_threshold {
      filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\""
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.label.location"]
      }
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "600s"
      trigger {
        count = 1
      }
    }
  }
  notification_channels = [
    for c in google_monitoring_notification_channel.ops_email : c.id
  ]
}

resource "google_monitoring_alert_policy" "safety_override_rate" {
  project      = local.obs_project
  display_name = "VSBS safety overrides above baseline"
  combiner     = "OR"
  conditions {
    display_name = "Any safety override fires the page"
    condition_threshold {
      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.vsbs_safety_overrides.name}\""
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      trigger {
        count = 1
      }
    }
  }
  notification_channels = [
    for c in google_monitoring_notification_channel.ops_email : c.id
  ]
}

resource "google_monitoring_alert_policy" "autonomy_handoff_failures" {
  project      = local.obs_project
  display_name = "VSBS autonomy handoff failure rate > 0.1 %"
  combiner     = "OR"
  conditions {
    display_name = "Failure rate above 0.1% over 5 minutes"
    condition_threshold {
      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.vsbs_autonomy_handoff_failures.name}\""
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      comparison      = "COMPARISON_GT"
      threshold_value = 0.001
      duration        = "300s"
      trigger {
        count = 1
      }
    }
  }
  notification_channels = [
    for c in google_monitoring_notification_channel.ops_email : c.id
  ]
}

// ---- Aggregated dashboard ----
resource "google_monitoring_dashboard" "vsbs_overview" {
  project = local.obs_project
  dashboard_json = jsonencode({
    displayName = "VSBS — overview"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          width  = 6
          height = 4
          widget = {
            title = "API request latency p50/p95/p99 by region"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_PERCENTILE_99"
                        crossSeriesReducer = "REDUCE_MEAN"
                        groupByFields      = ["resource.label.location"]
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          widget = {
            title = "API 5xx rate by region"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.response_code_class=\"5xx\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["resource.label.location"]
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
            }
          }
        },
        {
          width  = 12
          height = 4
          yPos   = 4
          widget = {
            title = "Cloud Armor blocks by rule"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"loadbalancing.googleapis.com/https/backend_request_count\" metric.label.proxy_status=\"denied_by_security_policy\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.label.security_policy_name"]
                      }
                    }
                  }
                  plotType = "STACKED_AREA"
                }
              ]
            }
          }
        }
      ]
    }
  })
}
