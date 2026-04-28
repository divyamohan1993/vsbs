// VSBS region module — provider pin.
// One per-region instance of this module is invoked from
// regions/india/main.tf and regions/us/main.tf. The provider configuration
// (project + region) is supplied by the caller, so this file only declares
// version constraints.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    google = {
      source                = "hashicorp/google"
      version               = "~> 6.0"
      configuration_aliases = [google]
    }
    google-beta = {
      source                = "hashicorp/google-beta"
      version               = "~> 6.0"
      configuration_aliases = [google-beta]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
