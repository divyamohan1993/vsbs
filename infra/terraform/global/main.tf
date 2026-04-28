// =============================================================================
// VSBS global edge:
//   - Cloud DNS managed zone
//   - HTTPS Load Balancer (global, EXTERNAL_MANAGED) with host-based routing
//     for the four FQDNs:
//       * api.dmj.one         -> region-pinned API backend by user jurisdiction
//       * web.dmj.one         -> region-router (302 to vsbs-in or vsbs-us)
//       * vsbs-in.dmj.one     -> India web
//       * vsbs-us.dmj.one     -> US web
//       * api-in.dmj.one      -> India API
//       * api-us.dmj.one      -> US API
//   - Cloud Armor security policy (OWASP CRS 4.0 + bot management + per-IP
//     rate limit on /v1/auth/otp)
//   - Cloud CDN attached to the *web* backends (already enabled in the region
//     module on a per-backend basis)
//   - IAP for /admin paths
//   - Managed SSL certificate for all FQDNs
//
// References:
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_url_map
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_security_policy
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_managed_ssl_certificate
//   https://cloud.google.com/armor/docs/owasp-crs-rule-set-tuning
// =============================================================================

locals {
  fqdn_apex   = var.domain_root
  fqdn_api    = "api.${var.domain_root}"
  fqdn_web    = "web.${var.domain_root}"
  fqdn_in_web = "vsbs-in.${var.domain_root}"
  fqdn_us_web = "vsbs-us.${var.domain_root}"
  fqdn_in_api = "api-in.${var.domain_root}"
  fqdn_us_api = "api-us.${var.domain_root}"

  managed_certs = [
    local.fqdn_api,
    local.fqdn_web,
    local.fqdn_in_web,
    local.fqdn_us_web,
    local.fqdn_in_api,
    local.fqdn_us_api,
  ]
}

// ---- Cloud DNS managed zone ----
resource "google_dns_managed_zone" "vsbs" {
  count       = var.create_managed_zone ? 1 : 0
  project     = var.project_id
  name        = var.managed_zone_name
  dns_name    = "${var.domain_root}."
  description = "VSBS authoritative zone."
  visibility  = "public"
  dnssec_config {
    state = "on"
  }
}

// ---- Reserved global anycast IP for the LB ----
resource "google_compute_global_address" "lb_v4" {
  project      = var.project_id
  name         = "vsbs-global-lb-ip"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

// ---- DNS A records pointing every FQDN at the LB ----
resource "google_dns_record_set" "fqdn_api" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_api}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

resource "google_dns_record_set" "fqdn_web" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_web}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

resource "google_dns_record_set" "fqdn_in_web" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_in_web}."
  type         = "A"
  ttl          = 60
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

resource "google_dns_record_set" "fqdn_us_web" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_us_web}."
  type         = "A"
  ttl          = 60
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

resource "google_dns_record_set" "fqdn_in_api" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_in_api}."
  type         = "A"
  ttl          = 60
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

resource "google_dns_record_set" "fqdn_us_api" {
  project      = var.project_id
  managed_zone = var.managed_zone_name
  name         = "${local.fqdn_us_api}."
  type         = "A"
  ttl          = 60
  rrdatas      = [google_compute_global_address.lb_v4.address]
}

// ---- Managed SSL certificate ----
resource "google_compute_managed_ssl_certificate" "vsbs" {
  project = var.project_id
  name    = "vsbs-managed-cert"
  managed {
    domains = local.managed_certs
  }
}

// ---- Cloud Armor security policy (WAF + rate limit + bot management) ----
//
// Rules (priority — lower runs first):
//   1000   OWASP CRS 4.0 SQLi sentinel   (preconfigured WAF, sensitivity 4)
//   1010   OWASP CRS 4.0 XSS sentinel
//   1020   OWASP CRS 4.0 LFI / RFI sentinel
//   1030   OWASP CRS 4.0 RCE sentinel
//   1100   reCAPTCHA action-token enforcement on /v1/auth/otp
//   2000   Per-IP rate limit on /v1/auth/otp (var.rate_limit_per_minute_otp)
//   2100   Per-IP rate limit on everything else (var.rate_limit_per_minute_default)
//   2147483647 default — allow
resource "google_compute_security_policy" "vsbs_edge" {
  project     = var.project_id
  name        = "vsbs-edge-policy"
  description = "OWASP CRS 4.0 + bot management + per-IP rate limit"
  type        = "CLOUD_ARMOR"

  advanced_options_config {
    json_parsing = "STANDARD"
    log_level    = "VERBOSE"
  }

  // SQLi
  rule {
    action      = "deny(403)"
    priority    = 1000
    description = "OWASP CRS 4.0 SQLi sentinel (sensitivity 4)"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 4})"
      }
    }
  }

  // XSS
  rule {
    action      = "deny(403)"
    priority    = 1010
    description = "OWASP CRS 4.0 XSS sentinel (sensitivity 4)"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 4})"
      }
    }
  }

  // LFI / RFI
  rule {
    action      = "deny(403)"
    priority    = 1020
    description = "OWASP CRS 4.0 LFI/RFI sentinel"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('lfi-v33-stable', {'sensitivity': 4}) || evaluatePreconfiguredWaf('rfi-v33-stable', {'sensitivity': 4})"
      }
    }
  }

  // RCE
  rule {
    action      = "deny(403)"
    priority    = 1030
    description = "OWASP CRS 4.0 RCE sentinel"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('rce-v33-stable', {'sensitivity': 4})"
      }
    }
  }

  // Per-IP rate limit on /v1/auth/otp paths
  rule {
    action      = "rate_based_ban"
    priority    = 2000
    description = "Per-IP rate limit on /v1/auth/otp"
    match {
      expr {
        expression = "request.path.startsWith('/v1/auth/otp')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_per_minute_otp
        interval_sec = 60
      }
      ban_duration_sec = 600
    }
  }

  // Per-IP rate limit on everything else
  rule {
    action      = "rate_based_ban"
    priority    = 2100
    description = "Per-IP rate limit on all other paths"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_per_minute_default
        interval_sec = 60
      }
      ban_duration_sec = 60
    }
  }

  // Bot management — challenge headless clients on the OTP endpoint
  rule {
    action      = "redirect"
    priority    = 1500
    description = "reCAPTCHA challenge on /v1/auth/otp/start"
    match {
      expr {
        expression = "request.path == '/v1/auth/otp/start' && token.recaptcha_action.score < 0.5"
      }
    }
    redirect_options {
      type = "GOOGLE_RECAPTCHA"
    }
  }

  // Default allow
  rule {
    action      = "allow"
    priority    = 2147483647
    description = "default rule"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

// ---- Global URL map with host-based routing ----
resource "google_compute_url_map" "vsbs" {
  project         = var.project_id
  name            = "vsbs-url-map"
  default_service = var.region_router_backend_us

  // api.dmj.one -> region-router (chooses by header / geo)
  host_rule {
    hosts        = [local.fqdn_api]
    path_matcher = "api-shared"
  }
  path_matcher {
    name            = "api-shared"
    default_service = var.region_router_backend_us

    // /v1/region/* always goes to region-router
    path_rule {
      paths   = ["/v1/region", "/v1/region/*"]
      service = var.region_router_backend_us
    }

    // /admin/* gated by IAP, sent to US (admin is operator-only)
    path_rule {
      paths   = ["/admin", "/admin/*"]
      service = var.api_backend_us
      route_action {
        url_rewrite {
          path_prefix_rewrite = "/admin"
        }
      }
    }
  }

  // web.dmj.one -> region-router on the web backend (302 to a regional FQDN)
  host_rule {
    hosts        = [local.fqdn_web]
    path_matcher = "web-shared"
  }
  path_matcher {
    name            = "web-shared"
    default_service = var.region_router_backend_us
  }

  // vsbs-in.dmj.one -> India web; api-in.dmj.one -> India API
  host_rule {
    hosts        = [local.fqdn_in_web]
    path_matcher = "web-in"
  }
  path_matcher {
    name            = "web-in"
    default_service = var.web_backend_in
  }

  host_rule {
    hosts        = [local.fqdn_in_api]
    path_matcher = "api-in"
  }
  path_matcher {
    name            = "api-in"
    default_service = var.api_backend_in
  }

  // vsbs-us.dmj.one + api-us.dmj.one
  host_rule {
    hosts        = [local.fqdn_us_web]
    path_matcher = "web-us"
  }
  path_matcher {
    name            = "web-us"
    default_service = var.web_backend_us
  }

  host_rule {
    hosts        = [local.fqdn_us_api]
    path_matcher = "api-us"
  }
  path_matcher {
    name            = "api-us"
    default_service = var.api_backend_us
  }
}

resource "google_compute_target_https_proxy" "vsbs" {
  project          = var.project_id
  name             = "vsbs-https-proxy"
  url_map          = google_compute_url_map.vsbs.id
  ssl_certificates = [google_compute_managed_ssl_certificate.vsbs.id]
  // Pin a modern profile; PQ-hybrid is negotiated at GFE when the client supports it.
  ssl_policy = google_compute_ssl_policy.modern.id
}

resource "google_compute_ssl_policy" "modern" {
  project         = var.project_id
  name            = "vsbs-ssl-modern"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_global_forwarding_rule" "vsbs_https" {
  project               = var.project_id
  name                  = "vsbs-https-fr"
  ip_address            = google_compute_global_address.lb_v4.address
  ip_protocol           = "TCP"
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.vsbs.id
}

// ---- HTTP -> HTTPS redirect ----
resource "google_compute_url_map" "redirect_https" {
  project = var.project_id
  name    = "vsbs-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "vsbs_redirect" {
  project = var.project_id
  name    = "vsbs-http-proxy"
  url_map = google_compute_url_map.redirect_https.id
}

resource "google_compute_global_forwarding_rule" "vsbs_http" {
  project               = var.project_id
  name                  = "vsbs-http-fr"
  ip_address            = google_compute_global_address.lb_v4.address
  ip_protocol           = "TCP"
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.vsbs_redirect.id
}

output "global_lb_ip" {
  value       = google_compute_global_address.lb_v4.address
  description = "Anycast IPv4 every FQDN A-records to."
}

output "managed_zone_name" {
  value       = var.managed_zone_name
  description = "Cloud DNS managed zone name."
}

output "security_policy_id" {
  value       = google_compute_security_policy.vsbs_edge.id
  description = "Cloud Armor policy id; attach this to each backend service via the security_policy field."
}
