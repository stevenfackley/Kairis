const target = process.argv[2];

if (!target) {
  console.error("Missing deploy target.");
  process.exit(1);
}

const messages = {
  "proxmox-test":
    "Deployment scaffold complete for Proxmox test. Use docker compose -f docker-compose.proxmox-test.yml up -d --build on the Proxmox host.",
  "ec2-production":
    "Deployment scaffold complete for EC2 production. Replace this step with the actual SSH, artifact sync, and service reload process."
};

if (!messages[target]) {
  console.error(`Unsupported deploy target: ${target}`);
  process.exit(1);
}

console.log(messages[target]);
