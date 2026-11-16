# BOXP-561 node-side relay: listen on node 127.0.0.1:PORT (root netns), then
# setns into the llama-server pod netns and forward each connection to its
# 127.0.0.1:8081 (llama router, bypasses envoy/admission). Run as root on node.
import os, socket, sys, threading
port, pid = int(sys.argv[1]), int(sys.argv[2])
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port)); srv.listen(16)
fd = os.open(f"/proc/{pid}/ns/net", os.O_RDONLY); os.setns(fd, os.CLONE_NEWNET); os.close(fd)
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
def handle(c):
    try: u = socket.create_connection(("127.0.0.1", 8081), timeout=10); u.settimeout(None)
    except OSError: c.close(); return
    threading.Thread(target=pipe, args=(u, c), daemon=True).start(); pipe(c, u)
print("relay ready", flush=True)
while True:
    c, _ = srv.accept(); threading.Thread(target=handle, args=(c,), daemon=True).start()
