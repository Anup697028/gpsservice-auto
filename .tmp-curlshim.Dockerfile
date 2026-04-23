FROM anuplt/gps_installation:api-v10
USER root
RUN printf '#!/bin/sh\nset -eu\nurl=""\nfor arg in "$@"; do\n  case "" in\n    -f|-s|-S|-fsS|-sfS|-sSf|-fSs|-Ss|-sS) ;;\n    http://*|https://*) url="" ;;\n  esac\ndone\n[ -n "" ] || { echo "missing URL" >&2; exit 2; }\nwget -qO- "" > /dev/null\n' > /usr/local/bin/curl && chmod +x /usr/local/bin/curl
ENTRYPOINT ["/usr/local/bin/curl"]