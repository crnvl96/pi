export const PERMISSION_GATE_BASH_PATTERNS: readonly RegExp[] = [
  // git reset --hard
  /(?:^|[;&|\n]\s*)\s*git\s+reset\b(?=[^;&|\n]*--hard\b)/i,
  // reset --hard
  /(?:^|[;&|\n]\s*)\s*reset\b(?=[^;&|\n]*--hard\b)/i,
  // git clean --force / git clean -f
  /(?:^|[;&|\n]\s*)\s*git\s+clean\b(?=[^;&|\n]*(?:-[^\s;&|]*f|--force\b))/i,
  // git push --force / git push --delete / git push -f
  /(?:^|[;&|\n]\s*)\s*git\s+push\b(?=[^;&|\n]*(?:--force(?:-with-lease)?\b|--delete\b|-[^\s;&|]*f))/i,
  // push --force / push -f
  /(?:^|[;&|\n]\s*)\s*push\b(?=[^;&|\n]*(?:--force(?:-with-lease)?\b|-[^\s;&|]*f))/i,
  // git branch -D
  /(?:^|[;&|\n]\s*)\s*git\s+branch\s+-D\b/i,
  // git checkout -- <path> / git checkout --force / git checkout -f
  /(?:^|[;&|\n]\s*)\s*git\s+checkout\b(?=[^;&|\n]*(?:\s--\s|\s-f\b|--force\b))/i,
  // git checkout .
  /(?:^|[;&|\n]\s*)\s*git\s+checkout\b(?=[^;&|\n]*\s\.(?:\s|$|[;&|\n]))/i,
  // git restore .
  /(?:^|[;&|\n]\s*)\s*git\s+restore\b(?=[^;&|\n]*\s\.(?:\s|$|[;&|\n]))/i,

  // sudo
  /(?:^|[;&|\n]\s*)\s*sudo\b/i,
  // rm -rf / rm --recursive --force
  /(?:^|[;&|\n]\s*)\s*rm\s+(?=[^;&|\n]*(?:-[^\s;&|]*r|--recursive\b))(?=[^;&|\n]*(?:-[^\s;&|]*f|--force\b))/i,
  // chmod -R on root/system paths or with broad permissions like 777/000/a+rwx
  /(?:^|[;&|\n]\s*)\s*chmod\s+(?=[^;&|\n]*(?:-R\b|--recursive\b))(?=[^;&|\n]*(?:\b(?:777|000)\b|\ba[+=]rwx\b|\s\/(?:\s|$)|\s\/(?:etc|usr|bin|sbin|lib|var|root)\b))/i,
  // chmod setuid/setgid or sticky permission forms like 4755/7777/+s
  /(?:^|[;&|\n]\s*)\s*chmod\s+[^;&|\n]*(?:\b[47][0-7]{3}\b|\b[ugoa]*\+s\b)/i,
  // chown -R on root/system paths
  /(?:^|[;&|\n]\s*)\s*chown\s+(?=[^;&|\n]*(?:-R\b|--recursive\b))(?=[^;&|\n]*(?:\s\/(?:\s|$)|\s\/(?:etc|usr|bin|sbin|lib|var|root)\b))/i,
  // mkfs on block devices
  /(?:^|[;&|\n]\s*)\s*mkfs(?:\.[\w-]+)?\b(?=[^;&|\n]*\/dev\/(?:sd[a-z]|hd[a-z]|xvd[a-z]|nvme\d+n\d+))/i,
  // dd writing to block devices
  /(?:^|[;&|\n]\s*)\s*dd\b(?=[^;&|\n]*\bof=\/dev\/(?:sd[a-z]|hd[a-z]|xvd[a-z]|nvme\d+n\d+))/i,
  // curl | sh / curl | bash / wget | sh / wget | bash
  /(?:^|[;&|\n]\s*)\s*(?:curl|wget)\b[^;&|\n]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/i,
  // shell fork bomb: :(){ :|: & };:
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,

  // aws s3 rm
  /(?:^|[;&|\n]\s*)\s*aws\s+s3\s+rm\b/i,
  // aws s3 rb
  /(?:^|[;&|\n]\s*)\s*aws\s+s3\s+rb\b/i,
  // aws s3 sync --delete
  /(?:^|[;&|\n]\s*)\s*aws\s+s3\s+sync\b(?=[^;&|\n]*--delete\b)/i,
  // aws <service> delete-* / terminate-* / remove-*
  /(?:^|[;&|\n]\s*)\s*aws\s+\S+\s+(?:delete|terminate|remove)-[a-z0-9-]+\b/i,
  // aws cloudformation update-termination-protection --no-enable-termination-protection
  /(?:^|[;&|\n]\s*)\s*aws\s+cloudformation\s+update-termination-protection\b(?=[^;&|\n]*--no-enable-termination-protection\b)/i,
];
