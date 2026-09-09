{
  description = "git-graph — a local git commit-graph viewer, as a single on-demand CLI (bgg)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      perSystem = flake-utils.lib.eachDefaultSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};

          pname = "git-graph";
          version = "0.1.0";

          # Vendored dependencies as a fixed-output derivation: `bun install`
          # needs the network, which only an FOD is allowed, so deps are fetched
          # once here and the build proper runs offline. The hash is content-
          # addressed and platform-specific — bun resolves some optional native
          # deps per system, so this is pinned per the flake-utils system split.
          # Refresh it after any bun.lock change: set `outputHash` to
          # `pkgs.lib.fakeHash`, run `nix build`, and copy the "got:" hash the
          # mismatch prints.
          nodeModules = pkgs.stdenv.mkDerivation {
            pname = "${pname}-node-modules";
            inherit version;
            # Only the files that determine the dependency set — so editing app
            # source never invalidates the (slow) dependency fetch.
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [
                ./package.json
                ./bun.lock
              ];
            };
            nativeBuildInputs = [ pkgs.bun ];
            dontConfigure = true;
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              export HOME="$TMPDIR"
              bun install --frozen-lockfile --no-progress --ignore-scripts
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R node_modules/. "$out/"
              runHook postInstall
            '';
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = "sha256-BIWdlrN5TYUsLIneDSOtI6ScKl6FG8a1UdnxvM+7tfI=";
          };

          git-graph = pkgs.stdenv.mkDerivation {
            inherit pname version;
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              # Everything the client + server + CLI bundles read at build time.
              fileset = pkgs.lib.fileset.unions [
                ./package.json
                ./bun.lock
                ./tsconfig.json
                ./vite.config.ts
                ./server
                ./shared
                ./src
                ./public
              ];
            };

            nativeBuildInputs = [
              pkgs.bun
              # Vite/rolldown shell out to `node` during the client build; the
              # sandbox has no node unless we add it. Build-time only — the
              # runtime closure is just bun + the self-contained dist bundles.
              pkgs.nodejs_22
              pkgs.makeWrapper
            ];

            configurePhase = ''
              runHook preConfigure
              # Bring in the vendored deps read-write so bun/vite can touch their
              # caches during the build without reaching for the network.
              cp -R ${nodeModules} node_modules
              chmod -R u+w node_modules
              export HOME="$TMPDIR"
              runHook postConfigure
            '';

            buildPhase = ''
              runHook preBuild
              export NODE_ENV=production
              # Run vite under `node` explicitly, not via `bunx` or its shebang:
              # `bunx` attempts a registry round-trip to resolve the bin even when
              # it is vendored, and the `#!/usr/bin/env node` shebang has no
              # /usr/bin/env in the sandbox — both fail with no useful output.
              # Client → dist/client, server + CLI bundles → dist/server. The
              # bundles are self-contained (bun inlines every dependency), so the
              # runtime closure is just bun + dist — node_modules is build-only.
              node node_modules/vite/bin/vite.js build
              bun build server/index.ts server/cli.ts \
                --outdir dist/server --target bun --sourcemap=linked --production
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib/${pname}"
              cp -R dist/. "$out/lib/${pname}/"

              # The single on-demand executable. `bgg` from anywhere in a
              # terminal serves the git repositories under the current directory;
              # the wrapper resolves the built CLI bundle beside the server bundle
              # so the ADR-0011 sibling lookup and the '../client' static-asset
              # path both hold. `git-graph` is provided as a spelled-out
              # alias (ADR-0008: package name = repo name).
              makeWrapper ${pkgs.bun}/bin/bun "$out/bin/bgg" \
                --add-flags "$out/lib/${pname}/server/cli.js"
              ln -s bgg "$out/bin/${pname}"
              runHook postInstall
            '';

            meta = {
              description = "Local git commit-graph viewer — browse your repositories' history in the browser";
              homepage = "https://github.com/binaryplease/git-graph";
              license = pkgs.lib.licenses.mit;
              mainProgram = "bgg";
              platforms = pkgs.lib.platforms.unix;
            };
          };
        in
        {
          packages.default = git-graph;
          packages.git-graph = git-graph;

          # `nix run` → serve the current directory's repositories on a free port
          # and open the browser. `nix run .# -- daemon start` etc. reach the
          # full CLI.
          apps.default = {
            type = "app";
            program = "${git-graph}/bin/bgg";
            meta = {
              description = "Serve the current directory's git repositories in the browser (bgg)";
              mainProgram = "bgg";
            };
          };

          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              bun
              mise
              nodejs_22
            ];
          };
        }
      );
    in
    perSystem
    // {
      # NixOS module: run the graph viewer as a hardened background daemon on a
      # box (the deployed counterpart of `bgg daemon start`). Loopback-bound by
      # default — front it with an authenticating reverse proxy and set
      # `allowedHosts` before exposing it (ADR-0037 §4; see README deployment).
      nixosModules.default =
        {
          config,
          pkgs,
          lib,
          ...
        }:
        let
          cfg = config.services.git-graph;
          package = self.packages.${pkgs.system}.default;
        in
        {
          options.services.git-graph = {
            enable = lib.mkEnableOption "git-graph commit-graph viewer";

            port = lib.mkOption {
              type = lib.types.port;
              default = 3010;
              description = ''
                Port for the graph server to listen on. Bound strictly (ADR-0018):
                a conflict is a fatal startup error, and systemd restarts the unit.
              '';
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = ''
                Bind address. Default is loopback so only a local reverse proxy
                can reach the service. A non-loopback host is a fatal startup
                error unless `allowedHosts` names the served host(s) — binding
                off loopback publishes an unauthenticated git API (ADR-0037 §4).
              '';
            };

            root = lib.mkOption {
              type = lib.types.str;
              example = "/srv/repositories";
              description = ''
                Absolute path of the directory scanned for git repositories (the
                root itself plus its direct children).
              '';
            };

            allowedHosts = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ ];
              example = [ "graph.example.com" ];
              description = ''
                Host name(s) the operator acknowledges when `host` is non-loopback
                (ADR-0037 §4). Required as the explicit acknowledgement that an
                authenticating reverse proxy fronts this unauthenticated API.
              '';
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "git-graph";
              description = "System user the service runs as. Must be able to read `root`.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.git-graph = {
              description = "git-graph — local git commit-graph viewer";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = {
                NODE_ENV = "production";
                HOST = cfg.host;
                PORT = toString cfg.port;
                GIT_GRAPH_ROOT = cfg.root;
                # A hosted daemon's port is a deliberate operator pin (ADR-0037):
                # bind it exactly and fail loud on a conflict rather than walking.
                GIT_GRAPH_PORT_STRATEGY = "strict";
                GIT_GRAPH_ALLOWED_HOSTS = lib.concatStringsSep "," cfg.allowedHosts;
              };

              # git-graph shells out to `git`; the sandboxed unit needs it on PATH.
              path = [ pkgs.git ];

              serviceConfig = {
                Type = "simple";
                # The server binary (not the CLI): systemd owns this lifecycle,
                # so it runs in the foreground and is supervised directly. The
                # install path is `lib/<pname>`, so read the name off the package
                # rather than spelling it again — the two cannot then drift.
                ExecStart = "${pkgs.bun}/bin/bun ${package}/lib/${package.pname}/server/index.js";
                Restart = "on-failure";
                RestartSec = 5;

                # Identity
                DynamicUser = false;
                User = cfg.user;
                Group = cfg.user;

                # Filesystem — read-only whole system, and the served root is
                # only reachable if it is world/user-readable. This service only
                # ever reads; it never needs to write.
                ProtectSystem = "strict";
                ProtectHome = "read-only";
                PrivateTmp = true;
                PrivateDevices = true;
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectKernelLogs = true;
                ProtectControlGroups = true;
                ProtectClock = true;
                ProtectHostname = true;
                ProtectProc = "invisible";
                ProcSubset = "pid";
                UMask = "0077";

                # Process / kernel
                NoNewPrivileges = true;
                LockPersonality = true;
                RestrictRealtime = true;
                RestrictSUIDSGID = true;
                RestrictNamespaces = true;
                RemoveIPC = true;

                # Network — IP + unix sockets only
                RestrictAddressFamilies = [
                  "AF_INET"
                  "AF_INET6"
                  "AF_UNIX"
                ];

                # Capabilities — an unprivileged listener needs none
                CapabilityBoundingSet = "";
                AmbientCapabilities = "";

                # Syscalls — system-service baseline minus the dangerous groups.
                # NOT MemoryDenyWriteExecute (breaks Bun's JIT); re-allow the
                # nice-level scheduler calls Bun makes at startup (RestrictRealtime
                # above still blocks the realtime policies).
                SystemCallFilter = [
                  "@system-service"
                  "~@privileged"
                  "~@resources"
                  "~@mount"
                  "~@obsolete"
                  "sched_setscheduler"
                  "sched_setparam"
                ];
                SystemCallArchitectures = "native";
              };
            };

            users.users.${cfg.user} = lib.mkDefault {
              isSystemUser = true;
              group = cfg.user;
              description = "git-graph service user";
            };
            users.groups.${cfg.user} = lib.mkDefault { };
          };
        };
    };
}
