# Secure compute isolation decision

Status: accepted architecture decision; implementation and production qualification
remain release-gated by EP-10-02 through EP-10-12.

Decision date: 2026-08-14

Owners: platform security and compute runtime owners

Review trigger: before the first compute runner implementation, on a material Kata
or Kubernetes runtime change, after any sandbox escape, and at least annually.

## Decision

Romeo's general-purpose compute plane will use **Kata Containers runtime-rs with
QEMU/KVM as the required GA isolation profile**, scheduled through a dedicated
Kubernetes `RuntimeClass` onto compute-only, hardware-virtualization-capable
nodes. One Kubernetes pod maps to one short-lived Kata VM and one Romeo compute
job. No VM, writable volume, network namespace, credential, or guest state is
reused across jobs.

The GA runtime class is named `romeo-compute-kata-qemu`. A compute job must fail
closed before claim if that runtime class, its verified guest assets, or a
compatible KVM node is unavailable. Falling back to `runc`, ordinary Docker,
the application/worker node pools, or an unverified runtime is prohibited.

Cloud Hypervisor may become a separately qualified Kata profile after the same
security, compatibility, restore, load, chaos, and independent penetration
gates pass. Firecracker remains a possible specialized high-density profile,
but it is not the initial portable Kubernetes baseline. gVisor can be used for
defense-in-depth on lower-risk internal workloads, but it is not Romeo's GA
boundary for hostile generated code.

This decision selects the isolation technology. It does **not** claim that a
compute service, runner, runtime image, `RuntimeClass`, or production node pool
currently exists.

## Workload and threat model

The guest workload is adversarial. It may contain model-generated or
user-supplied Python/JavaScript intended to:

- escape the guest, exploit the runtime, kernel, VMM, device model, or runner;
- read host, cluster, another job, another tenant, or Romeo control/data-plane
  state;
- use metadata services, Kubernetes credentials, Unix sockets, device nodes,
  host mounts, `/proc`, `/sys`, debug interfaces, or ambient environment data;
- exhaust CPU, memory, PIDs, storage, I/O, logs, network, image pulls, or job
  capacity;
- persist after cancellation, timeout, worker loss, or node drain;
- smuggle data through artifacts, archives, filenames, logs, DNS, timing, or
  policy-approved network destinations; or
- tamper with runtime images, guest kernels, policies, result envelopes,
  provenance, or workload identity.

The host operating system, KVM, Kata runtime and guest assets, Kubernetes
control plane, admission policy, image registry, signing roots, and Romeo claim
service are trusted but fallible. A compromised guest must not obtain authority
merely because it runs inside a VM. Hardware side channels and denial of service
remain residual risks requiring patched firmware/kernel/VMM, node isolation,
resource controls, and capacity protection.

## Options considered

| Option                                                        | Security boundary                                                                                | Kubernetes/OCI fit                                     | Compatibility and operations                                                                                                               | Decision                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Ordinary `runc`/Docker plus namespaces, seccomp, and AppArmor | Shares the host kernel with hostile code                                                         | Excellent                                              | Lowest operational cost, but a permitted kernel surface remains an escape path                                                             | Rejected as the GA boundary         |
| gVisor `runsc`                                                | Userspace application kernel intercepts guest system calls, with host controls as a second layer | Strong                                                 | Efficient and operationally attractive; incomplete Linux compatibility and syscall/I/O overhead must be tested                             | Optional lower-risk profile only    |
| Kata Containers + QEMU/KVM                                    | Per-pod lightweight VM with a separate guest kernel and hardware virtualization                  | Strong `containerd`/CRI and `RuntimeClass` integration | Most mature, feature-complete Kata hypervisor; higher startup/resource cost than lighter VMMs                                              | **Selected GA baseline**            |
| Kata Containers + Cloud Hypervisor                            | Same Kata VM boundary with a smaller Rust VMM                                                    | Strong                                                 | Attractive security/overhead profile, but must prove Romeo's filesystem, network, observability, and operations matrix                     | Future separately qualified profile |
| Firecracker + jailer/containerd integration                   | Minimal KVM microVM plus jailer/cgroup/namespace controls                                        | More specialized                                       | Excellent density/startup and a strong production posture; partial Kata CRI features and more bespoke lifecycle/network/storage operations | Future specialized profile          |

The choice prioritizes a hardware-virtualized per-job boundary, Kubernetes-native
scheduling, ecosystem maturity, and broad workload compatibility over minimum
cold-start latency. Kata documents hardware virtualization as a second isolation
layer and supports explicit Kubernetes `RuntimeClass` selection. Its current
virtualization guide describes QEMU as its most mature and feature-complete
hypervisor. Kubernetes `RuntimeClass` also supports scheduler node constraints
and pod overhead, which Romeo must configure rather than relying on a pod label
alone.

Primary references:

- [Kata Containers architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/README.md)
- [Kata virtualization and hypervisor comparison](https://github.com/kata-containers/kata-containers/blob/main/docs/design/virtualization.md)
- [Kata installation prerequisites](https://github.com/kata-containers/kata-containers/blob/main/docs/installation.md)
- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/)
- [gVisor security model](https://gvisor.dev/docs/architecture_guide/security/)
- [gVisor production guide](https://gvisor.dev/docs/user_guide/production/)
- [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
- [Firecracker jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)

## Required deployment boundary

### Dedicated nodes and scheduling

- Compute runs only on tainted, labelled compute nodes with KVM enabled. No app,
  database, Valkey, object-store, provider, migration, monitoring, ingress, or
  cluster administration workload shares those nodes.
- Admission requires `runtimeClassName: romeo-compute-kata-qemu`, the compute
  namespace, an allowed service account, a digest-pinned runner image, and the
  expected workload labels. Mutation or omission is denied.
- The `RuntimeClass` defines a handler installed by a pinned Kata release,
  scheduling constraints for qualified nodes, and measured pod overhead.
- Node autoscaling, upgrades, and drains must preserve the no-fallback rule.
  Unschedulable jobs remain queued or fail with a safe availability code.
- Nested virtualization is not assumed. Each supported cloud/on-prem target must
  prove KVM and Kata support using the exact instance and host configuration.

### Guest and runtime

- Runtime, guest kernel, guest image, runner image, policy bundle, and optional
  firmware are digest-pinned, signed, SBOMed, vulnerability-scanned, licensed,
  and admission-verified as one compatible release set.
- One pod/VM/job; no multi-job guest. Root is read-only. Job scratch and output
  staging are fresh, size-bounded, encrypted where supported, mounted `noexec`
  except for the explicit code/runtime mount, and destroyed at terminal state.
- The workload runs as a non-root UID with no Linux capabilities, no privilege
  escalation, no privileged mode, no host namespaces, no host paths, no device
  passthrough, no KVM inside the guest, and no service-account token.
- The guest receives no provider, database, object-store, Kubernetes, node,
  telemetry, or Romeo service credentials. Job-scoped credentials use a short
  TTL, audience, job/attempt/runner binding, least privilege, and terminal
  revocation.
- Stdout, stderr, result, file count, file size, archive expansion, and metadata
  are bounded. Raw exceptions and environment data never become user-facing
  errors.

### Network

- Default is no network interface usable by the workload. A job requiring
  network must select an enabled named egress policy before claim.
- Allowed traffic goes through Romeo's canonical authenticated, DNS-pinned
  egress proxy. The guest cannot reach DNS directly, metadata endpoints,
  loopback/host/cluster/private/link-local/multicast ranges, Kubernetes APIs, or
  data/control planes.
- Policy caps destinations, methods, requests, bytes, redirects, response size,
  wall time, and concurrency. Resolution and connection are pinned together;
  redirect targets are revalidated.
- Network namespace and proxy state are job-scoped and destroyed with the job.
  Network policy is defense-in-depth, not the sole egress boundary.

### Claim, execution, and publication

- The application never launches a VM directly. A separately scalable runner
  control plane consumes signed, versioned job claims and returns signed,
  versioned metadata/result envelopes.
- Every attempt binds job ID, tenant, lease, runner workload identity, runtime
  digest, guest-assets digest, policy version, input hashes, resource limits,
  and expiry. Stale or mismatched claims/results fail closed.
- CPU, memory, PIDs, disk, I/O, log bytes, network, and wall time have hard
  limits at guest, VMM/cgroup, Kubernetes, and Romeo lease layers. A limit or
  cancellation kills the complete VM, not just the child process.
- Output remains quarantined until path, symlink, count, size, type, archive,
  malware, content-policy/DLP, tenant, lease, and hash validation succeeds.
  Artifact publication and terminal receipt are idempotent and transactional.
- Cleanup is independently retryable. Orphaned VM, network, volume, credential,
  lease, and artifact-staging backlogs are metered and release-alerting.

## Unsupported and fail-closed cases

Romeo must reject or leave queued a compute request when any of these applies:

- the capability is disabled at deployment/platform/entitlement/org/workspace/
  agent/group/user/action/resource layers;
- the selected runtime/image/network policy is unavailable, unverified,
  mutable, expired, revoked, or outside the operator allowlist;
- the target cluster cannot prove the required Kata runtime class and KVM node;
- resource or artifact limits cannot be represented at every required layer;
- workload identity, lease, egress proxy, scanner, DLP, object storage, audit,
  quota, or cleanup service is unavailable under its configured fail policy;
- an input is inaccessible, unscanned, quarantined, retained incompatibly, or
  changes after policy resolution; or
- a target advertises only ordinary containers or gVisor for hostile compute.

There is no compatibility fallback to application-host tools, local `exec`, a
shell inside an existing worker, browser-automation workers, or Docker Compose.

## Operational review and cost

The selected boundary adds KVM-capable node requirements, guest/runtime asset
patching, larger cold starts and memory overhead, RuntimeClass/admission
administration, node-drain complexity, separate capacity forecasts, and VMM
observability. Those costs are accepted because hostile general-purpose code is
categorically different from a predeclared connector operation.

Before rollout, operators need runbooks for:

- compatible Kata/runtime/guest/host upgrades and rollback without mixing
  unverified asset versions;
- compute-node bootstrap, drift detection, quarantine, drain, replacement, and
  forensic preservation;
- KVM/firmware/kernel/VMM advisories and emergency disablement;
- queue saturation, lease takeover, stuck termination, orphan cleanup, and
  unavailable scanner/DLP/egress dependencies;
- per-runtime capacity, cold-start, execution, artifact-validation, and cleanup
  SLOs; and
- online and air-gapped signing, distribution, revocation, and evidence
  collection for every runtime asset.

## Qualification gates

The runtime profile is not production-supported until evidence from the exact
target topology proves all of the following:

1. Admission rejects missing/wrong runtime class, mutable or unsigned assets,
   non-compute nodes, privileged fields, host mounts/namespaces, service-account
   tokens, devices, excess resources, and disallowed network configuration.
2. Runtime inspection from inside a job proves the guest kernel boundary and
   absence of host filesystem, sockets, devices, metadata, credentials, and
   control/data-plane routes.
3. Escape and abuse corpus covers kernel/VMM/device inputs, `/proc`/`/sys`, Unix
   sockets, symlinks, path traversal, archive bombs, fork bombs, huge memory/
   disk/I/O/log/network use, DNS rebinding, private endpoints, and malicious
   result envelopes.
4. Kill, cancel, timeout, OOM, node loss, runner crash, control-plane restart,
   lease expiry/takeover, and rolling deployment destroy or safely recover the
   entire VM with no duplicate execution billing or artifact publication.
5. A cross-job/cross-tenant sentinel corpus proves no filesystem, memory,
   network, credential, log, cache, snapshot, or artifact leakage.
6. Signed runtime/guest/runner assets are rebuilt, scanned, SBOMed, attested,
   revoked, upgraded, rolled back, and restored in both advertised connected
   and air-gapped modes.
7. Representative workloads establish cold-start, queue, execution, artifact
   validation, memory, CPU, storage, and density baselines without relaxing
   security limits; chaos and soak meet provisional SLOs.
8. Independent sandbox penetration testing covers the assembled Romeo runner,
   Kata/QEMU profile, host hardening, egress proxy, claim protocol, and artifact
   boundary. Any sandbox escape or cross-tenant read blocks GA.

Metadata-only evidence must record exact digests, versions, target topology,
test identifiers, counts, timings, and pass/fail state without customer code,
inputs, outputs, environment, network destinations, secrets, or raw errors.

## Consequences and follow-up

EP-10-02 through EP-10-12 must implement the runner protocol, sandbox posture,
egress, package and secret policy, artifact validation/provenance/versioning,
safe rendering, lifecycle, and operations against this boundary. The compute
capability remains unavailable until those slices and all qualification gates
pass. A future runtime profile is additive and cannot silently replace this
baseline; it requires its own signed configuration and complete evidence set.
