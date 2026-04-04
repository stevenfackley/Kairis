const target = process.argv[2];

if (!target) {
  console.error("Missing deploy target.");
  process.exit(1);
}

const messages = {
  "proxmox-test":
    "Deployment scaffold complete for Proxmox test. Replace this step with the actual artifact sync or service restart process.",
  "ec2-production":
    "Deployment scaffold complete for EC2 production. Replace this step with the actual SSH, artifact sync, and service reload process."
};

if (!messages[target]) {
  console.error(`Unsupported deploy target: ${target}`);
  process.exit(1);
}

console.log(messages[target]);
