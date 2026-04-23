FROM postgres:16-alpine
RUN printf '#!/bin/sh\nset -eu\nurl=""\nfor arg in "$@"; do\n  case "$arg" in\n    http://*|https://*) url="$arg" ;;\n  esac\ndone\n[ -n "$url" ] || { echo "missing URL" >&2; exit 2; }\nwget -q -O /dev/null "$url"\n' > /usr/local/bin/curl && chmod +x /usr/local/bin/curl
ENTRYPOINT ["/usr/local/bin/curl"]