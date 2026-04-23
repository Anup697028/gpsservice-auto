FROM anuplt/gps_installation:api-v10
USER root
RUN printf '#!/bin/sh\nset -eu\nurl=""\nfor arg in "$@"; do\n  case "$arg" in\n    -f|-s|-S|-fsS|-sfS|-sSf|-fSs|-Ss|-sS) ;;&\n    http://*|https://*) url="$arg" ;;&\n    *) ;;&\n  esac\ndone\n[ -n "$url" ] || { echo "missing URL" >&2; exit 2; }\nwget -qO- "$url" > /dev/null\n' > /usr/local/bin/curl && chmod +x /usr/local/bin/curl
ENTRYPOINT ["/usr/local/bin/curl"]