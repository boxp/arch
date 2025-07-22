#!/bin/bash
# Armbian customize-image.sh
# This script runs INSIDE the chroot during Armbian build process
set -e

echo "🍊 Starting Orange Pi Zero 3 image customization"
echo "📋 Environment:"
echo "  - Node name: ${ORANGEPI_NODE_NAME:-unknown}"
echo "  - Current directory: $(pwd)"
echo "  - Running as: $(whoami)"

# Install Ansible
echo "📦 Installing Ansible..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ansible python3-pip

# Copy Ansible playbooks from build environment to rootfs
# The /tmp/overlay is where Armbian mounts external files
echo "📋 Copying Ansible playbooks..."
if [ -d "/tmp/overlay/ansible" ]; then
    cp -r /tmp/overlay/ansible /root/ansible
else
    echo "❌ Error: Ansible directory not found in /tmp/overlay/"
    echo "📂 Available in overlay:"
    ls -la /tmp/overlay/ 2>/dev/null || echo "Overlay not accessible"
    exit 1
fi

# Set node name from environment
NODE_NAME="${ORANGEPI_NODE_NAME:-unknown}"

# Create inventory for local execution
cat > /root/ansible/inventory.ini << EOF
[all]
localhost ansible_connection=local
EOF

# Run Ansible playbooks with local connection
cd /root/ansible

echo "📋 Running control-plane playbook..."
if [ -f "playbooks/control-plane.yml" ]; then
    ansible-playbook \
        -i inventory.ini \
        -e node_name="$NODE_NAME" \
        -e chroot_build=true \
        -c local \
        playbooks/control-plane.yml
else
    echo "⚠️ control-plane.yml not found"
fi

echo "📋 Running node-specific playbook for $NODE_NAME..."
if [ -f "playbooks/node-$NODE_NAME.yml" ]; then
    ansible-playbook \
        -i inventory.ini \
        -e node_name="$NODE_NAME" \
        -e chroot_build=true \
        -c local \
        playbooks/node-$NODE_NAME.yml
else
    echo "⚠️ playbooks/node-$NODE_NAME.yml not found"
fi

# Cleanup
rm -rf /root/ansible

echo "✅ Orange Pi Zero 3 customization completed!"