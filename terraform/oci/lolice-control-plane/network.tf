locals {
  vcn_cidr    = "10.0.0.0/16"
  subnet_cidr = "10.0.1.0/24"
}

resource "oci_core_vcn" "lolice_cp" {
  compartment_id = local.compartment_id
  cidr_block     = local.vcn_cidr
  display_name   = "lolice-cloud-control-plane"
  dns_label      = "lolicecpvcn"
}

resource "oci_core_internet_gateway" "lolice_cp" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.lolice_cp.id
  display_name   = "lolice-cp-igw"
  enabled        = true
}

resource "oci_core_route_table" "lolice_cp" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.lolice_cp.id
  display_name   = "lolice-cp-route-table"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.lolice_cp.id
  }
}

resource "oci_core_security_list" "lolice_cp" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.lolice_cp.id
  display_name   = "lolice-cp-security-list"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    stateless   = false
  }

  # SSH for emergency access (restrict to trusted IPs in production)
  ingress_security_rules {
    protocol  = "6" # TCP
    source    = "0.0.0.0/0"
    stateless = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  # Tailscale UDP (WireGuard)
  ingress_security_rules {
    protocol  = "17" # UDP
    source    = "0.0.0.0/0"
    stateless = false

    udp_options {
      min = 41641
      max = 41641
    }
  }
}

resource "oci_core_subnet" "lolice_cp" {
  compartment_id             = local.compartment_id
  vcn_id                     = oci_core_vcn.lolice_cp.id
  cidr_block                 = local.subnet_cidr
  display_name               = "lolice-cp-subnet"
  dns_label                  = "lolicecpsubnet"
  route_table_id             = oci_core_route_table.lolice_cp.id
  security_list_ids          = [oci_core_security_list.lolice_cp.id]
  prohibit_public_ip_on_vnic = false
}
