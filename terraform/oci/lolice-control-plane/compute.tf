locals {
  compartment_id = var.compartment_ocid != "" ? var.compartment_ocid : var.tenancy_ocid

  # Ubuntu 22.04 LTS (Jammy) for ARM64 in ap-tokyo-1.
  # Use a data source to always pick the latest canonical image.
  image_display_name = "Canonical-Ubuntu-22.04-aarch64"
}

data "oci_core_images" "ubuntu_22_arm64" {
  compartment_id           = local.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "oracle_cp_1" {
  compartment_id      = local.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "oracle-cp-1"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_22_arm64.images[0].id
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.lolice_cp.id
    assign_public_ip = true
    hostname_label   = "oracle-cp-1"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(local.cloud_init_cp1)
  }

  freeform_tags = {
    Project = "lolice"
    Role    = "cloud-control-plane"
  }
}

resource "oci_core_instance" "oracle_cp_2" {
  compartment_id      = local.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "oracle-cp-2"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_22_arm64.images[0].id
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.lolice_cp.id
    assign_public_ip = true
    hostname_label   = "oracle-cp-2"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(local.cloud_init_cp2)
  }

  freeform_tags = {
    Project = "lolice"
    Role    = "cloud-control-plane"
  }
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = local.compartment_id
}
