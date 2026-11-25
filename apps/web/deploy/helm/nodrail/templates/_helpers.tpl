{{- define "nodrail.name" -}}
{{- printf "%s-nodrail" .Release.Name | trunc 53 | trimSuffix "-" -}}
{{- end }}

{{- define "nodrail.labels" -}}
app.kubernetes.io/name: nodrail
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end }}

{{- define "nodrail.serverImage" -}}
{{- include "nodrail.image" (dict "repository" .Values.image.repository "tag" (default .Chart.AppVersion .Values.image.tag) "digest" .Values.image.digest) -}}
{{- end }}

{{- define "nodrail.migrationImage" -}}
{{- $serverTag := default .Chart.AppVersion .Values.image.tag -}}
{{- include "nodrail.image" (dict "repository" .Values.migration.repository "tag" (default $serverTag .Values.migration.tag) "digest" .Values.migration.digest) -}}
{{- end }}

{{- define "nodrail.image" -}}
{{- if .digest -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" .digest) -}}
{{- fail (printf "image digest for %s must be sha256 followed by 64 lowercase hex digits" .repository) -}}
{{- end -}}
{{- printf "%s@%s" .repository .digest -}}
{{- else -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end -}}
{{- end }}

{{- define "nodrail.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "nodrail.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
{{- end }}

{{- define "nodrail.appOrigin" -}}
{{- $origin := default "http://localhost:3000" .Values.appOrigin -}}
{{- $url := urlParse $origin -}}
{{- $loopback := regexMatch "^(localhost|127([.][0-9]{1,3}){3}|::1)$" (lower $url.hostname) -}}
{{- if or (not $url.hostname) (ne $origin (printf "%s://%s" $url.scheme $url.host)) (not (or (eq $url.scheme "https") (and $loopback (eq $url.scheme "http")))) -}}
{{- fail "appOrigin must be an HTTPS origin or a loopback HTTP origin" -}}
{{- end -}}
{{- $origin -}}
{{- end -}}
