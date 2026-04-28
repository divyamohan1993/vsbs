project_id          = "your-gcp-project"
region              = "asia-south1"
firestore_location  = "asia-south1"
api_image           = "asia-south1-docker.pkg.dev/your-gcp-project/vsbs-in-images/api:v0.2.0"
web_image           = "asia-south1-docker.pkg.dev/your-gcp-project/vsbs-in-images/web:v0.2.0"
region_router_image = "asia-south1-docker.pkg.dev/your-gcp-project/vsbs-in-images/region-router:v0.2.0"

domain_root       = "dmj.one"
managed_zone_name = "vsbs-zone"

rate_limit_per_minute_otp     = 100
rate_limit_per_minute_default = 600

# Optional: gate /admin paths behind a specific IAM principal via IAP.
iap_admin_member = "group:vsbs-ops@dmj.one"
