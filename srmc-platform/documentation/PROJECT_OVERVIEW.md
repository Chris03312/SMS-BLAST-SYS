
```
SMS-BLAST-SYS
├─ srmc-platform
│  ├─ .env
│  ├─ .env.example
│  ├─ central-server
│  │  ├─ data
│  │  │  └─ central.db
│  │  ├─ db.js
│  │  ├─ index.js
│  │  ├─ package-lock.json
│  │  └─ package.json
│  ├─ client
│  │  ├─ dist
│  │  │  ├─ assets
│  │  │  │  ├─ index-DbpTbMCY.js
│  │  │  │  └─ LOGO.png
│  │  │  ├─ css
│  │  │  │  ├─ admin.css
│  │  │  │  ├─ agent.css
│  │  │  │  ├─ login.css
│  │  │  │  ├─ shared.css
│  │  │  │  └─ tokens.css
│  │  │  └─ index.html
│  │  ├─ index.html
│  │  ├─ package-lock.json
│  │  ├─ package.json
│  │  ├─ public
│  │  │  ├─ assets
│  │  │  │  └─ LOGO.png
│  │  │  └─ css
│  │  │     ├─ admin.css
│  │  │     ├─ agent.css
│  │  │     ├─ login.css
│  │  │     ├─ shared.css
│  │  │     └─ tokens.css
│  │  ├─ src
│  │  │  ├─ App.jsx
│  │  │  ├─ components
│  │  │  │  ├─ AdminShell.jsx
│  │  │  │  ├─ AgentShell.jsx
│  │  │  │  ├─ LiveBadge.jsx
│  │  │  │  ├─ Modal.jsx
│  │  │  │  └─ Pill.jsx
│  │  │  ├─ context
│  │  │  │  └─ AuthContext.jsx
│  │  │  ├─ lib
│  │  │  │  ├─ api.js
│  │  │  │  ├─ format.js
│  │  │  │  └─ ws.js
│  │  │  ├─ main.jsx
│  │  │  └─ pages
│  │  │     ├─ admin
│  │  │     │  ├─ Activity.jsx
│  │  │     │  ├─ Agents.jsx
│  │  │     │  ├─ Analytics.jsx
│  │  │     │  ├─ Billing.jsx
│  │  │     │  ├─ Campaigns.jsx
│  │  │     │  ├─ Dashboard.jsx
│  │  │     │  ├─ Inbound.jsx
│  │  │     │  ├─ Numbers.jsx
│  │  │     │  ├─ Settings.jsx
│  │  │     │  ├─ Templates.jsx
│  │  │     │  └─ Webhooks.jsx
│  │  │     ├─ agent
│  │  │     │  ├─ BlastDashboard.jsx
│  │  │     │  ├─ Dashboard.jsx
│  │  │     │  ├─ Gateway.jsx
│  │  │     │  ├─ History.jsx
│  │  │     │  ├─ Inbound.jsx
│  │  │     │  └─ Templates.jsx
│  │  │     └─ Login.jsx
│  │  └─ vite.config.js
│  ├─ data
│  │  ├─ INITIAL_ADMIN.txt
│  │  ├─ secrets.json
│  │  └─ srmc.db
│  ├─ dist-electron
│  │  ├─ .icon-ico
│  │  │  └─ icon.ico
│  │  ├─ alpha.yml
│  │  ├─ beta.yml
│  │  ├─ builder-debug.yml
│  │  ├─ builder-effective-config.yaml
│  │  ├─ latest.yml
│  │  ├─ SRMC Platform Portable 1.0.0.exe
│  │  ├─ SRMC Platform Setup 1.0.0.exe
│  │  ├─ SRMC Platform Setup 1.0.0.exe.blockmap
│  │  └─ win-unpacked
│  │     ├─ chrome_100_percent.pak
│  │     ├─ chrome_200_percent.pak
│  │     ├─ d3dcompiler_47.dll
│  │     ├─ ffmpeg.dll
│  │     ├─ icudtl.dat
│  │     ├─ libEGL.dll
│  │     ├─ libGLESv2.dll
│  │     ├─ LICENSE.electron.txt
│  │     ├─ LICENSES.chromium.html
│  │     ├─ locales
│  │     │  ├─ af.pak
│  │     │  ├─ am.pak
│  │     │  ├─ ar.pak
│  │     │  ├─ bg.pak
│  │     │  ├─ bn.pak
│  │     │  ├─ ca.pak
│  │     │  ├─ cs.pak
│  │     │  ├─ da.pak
│  │     │  ├─ de.pak
│  │     │  ├─ el.pak
│  │     │  ├─ en-GB.pak
│  │     │  ├─ en-US.pak
│  │     │  ├─ es-419.pak
│  │     │  ├─ es.pak
│  │     │  ├─ et.pak
│  │     │  ├─ fa.pak
│  │     │  ├─ fi.pak
│  │     │  ├─ fil.pak
│  │     │  ├─ fr.pak
│  │     │  ├─ gu.pak
│  │     │  ├─ he.pak
│  │     │  ├─ hi.pak
│  │     │  ├─ hr.pak
│  │     │  ├─ hu.pak
│  │     │  ├─ id.pak
│  │     │  ├─ it.pak
│  │     │  ├─ ja.pak
│  │     │  ├─ kn.pak
│  │     │  ├─ ko.pak
│  │     │  ├─ lt.pak
│  │     │  ├─ lv.pak
│  │     │  ├─ ml.pak
│  │     │  ├─ mr.pak
│  │     │  ├─ ms.pak
│  │     │  ├─ nb.pak
│  │     │  ├─ nl.pak
│  │     │  ├─ pl.pak
│  │     │  ├─ pt-BR.pak
│  │     │  ├─ pt-PT.pak
│  │     │  ├─ ro.pak
│  │     │  ├─ ru.pak
│  │     │  ├─ sk.pak
│  │     │  ├─ sl.pak
│  │     │  ├─ sr.pak
│  │     │  ├─ sv.pak
│  │     │  ├─ sw.pak
│  │     │  ├─ ta.pak
│  │     │  ├─ te.pak
│  │     │  ├─ th.pak
│  │     │  ├─ tr.pak
│  │     │  ├─ uk.pak
│  │     │  ├─ ur.pak
│  │     │  ├─ vi.pak
│  │     │  ├─ zh-CN.pak
│  │     │  └─ zh-TW.pak
│  │     ├─ resources
│  │     │  ├─ app
│  │     │  │  ├─ .env
│  │     │  │  ├─ client
│  │     │  │  │  └─ dist
│  │     │  │  │     ├─ assets
│  │     │  │  │     │  ├─ index-DbpTbMCY.js
│  │     │  │  │     │  └─ LOGO.png
│  │     │  │  │     ├─ css
│  │     │  │  │     │  ├─ admin.css
│  │     │  │  │     │  ├─ agent.css
│  │     │  │  │     │  ├─ login.css
│  │     │  │  │     │  ├─ shared.css
│  │     │  │  │     │  └─ tokens.css
│  │     │  │  │     └─ index.html
│  │     │  │  ├─ electron
│  │     │  │  │  ├─ icon.png
│  │     │  │  │  ├─ main.js
│  │     │  │  │  └─ preload.cjs
│  │     │  │  ├─ package.json
│  │     │  │  └─ server
│  │     │  │     ├─ app.js
│  │     │  │     ├─ broadcast-engine.js
│  │     │  │     ├─ db.js
│  │     │  │     ├─ fix-timestamps.js
│  │     │  │     ├─ gateway-poller.js
│  │     │  │     ├─ index.js
│  │     │  │     ├─ middleware
│  │     │  │     │  └─ auth.js
│  │     │  │     ├─ ngrok-tunnel.js
│  │     │  │     ├─ phone.js
│  │     │  │     ├─ routes
│  │     │  │     │  ├─ activity.js
│  │     │  │     │  ├─ agents.js
│  │     │  │     │  ├─ auth.js
│  │     │  │     │  ├─ broadcasts.js
│  │     │  │     │  ├─ campaigns.js
│  │     │  │     │  ├─ gateway-auth.js
│  │     │  │     │  ├─ gateway-outbound.js
│  │     │  │     │  ├─ gateways.js
│  │     │  │     │  ├─ inbound.js
│  │     │  │     │  ├─ settings.js
│  │     │  │     │  ├─ stats.js
│  │     │  │     │  └─ templates.js
│  │     │  │     ├─ secrets.js
│  │     │  │     ├─ send-logger.js
│  │     │  │     ├─ services
│  │     │  │     │  ├─ config-service.js
│  │     │  │     │  ├─ gateway-service.js
│  │     │  │     │  └─ stats-service.js
│  │     │  │     ├─ stats-reporter.js
│  │     │  │     └─ ws.js
│  │     │  ├─ app-update.yml
│  │     │  └─ elevate.exe
│  │     ├─ resources.pak
│  │     ├─ snapshot_blob.bin
│  │     ├─ SRMC Platform.exe
│  │     ├─ v8_context_snapshot.bin
│  │     ├─ vk_swiftshader.dll
│  │     ├─ vk_swiftshader_icd.json
│  │     └─ vulkan-1.dll
│  ├─ electron
│  │  ├─ icon.png
│  │  ├─ main.js
│  │  ├─ make-icon.mjs
│  │  └─ preload.cjs
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ README.md
│  └─ server
│     ├─ app.js
│     ├─ broadcast-engine.js
│     ├─ db.js
│     ├─ fix-timestamps.js
│     ├─ gateway-poller.js
│     ├─ index.js
│     ├─ middleware
│     │  └─ auth.js
│     ├─ ngrok-tunnel.js
│     ├─ phone.js
│     ├─ routes
│     │  ├─ activity.js
│     │  ├─ agents.js
│     │  ├─ auth.js
│     │  ├─ broadcasts.js
│     │  ├─ campaigns.js
│     │  ├─ gateway-auth.js
│     │  ├─ gateway-outbound.js
│     │  ├─ gateways.js
│     │  ├─ inbound.js
│     │  ├─ settings.js
│     │  ├─ stats.js
│     │  └─ templates.js
│     ├─ secrets.js
│     ├─ send-logger.js
│     ├─ services
│     │  ├─ config-service.js
│     │  ├─ gateway-service.js
│     │  └─ stats-service.js
│     ├─ stats-reporter.js
│     └─ ws.js
└─ SRMCGateway
   ├─ .gradle
   │  ├─ 8.4
   │  │  ├─ checksums
   │  │  │  ├─ checksums.lock
   │  │  │  ├─ md5-checksums.bin
   │  │  │  └─ sha1-checksums.bin
   │  │  ├─ dependencies-accessors
   │  │  │  ├─ dependencies-accessors.lock
   │  │  │  └─ gc.properties
   │  │  ├─ executionHistory
   │  │  │  ├─ executionHistory.bin
   │  │  │  └─ executionHistory.lock
   │  │  ├─ fileChanges
   │  │  │  └─ last-build.bin
   │  │  ├─ fileHashes
   │  │  │  ├─ fileHashes.bin
   │  │  │  ├─ fileHashes.lock
   │  │  │  └─ resourceHashesCache.bin
   │  │  ├─ gc.properties
   │  │  └─ vcsMetadata
   │  ├─ buildOutputCleanup
   │  │  ├─ buildOutputCleanup.lock
   │  │  ├─ cache.properties
   │  │  └─ outputFiles.bin
   │  ├─ config.properties
   │  ├─ file-system.probe
   │  └─ vcs-1
   │     └─ gc.properties
   ├─ .idea
   │  ├─ AndroidProjectSystem.xml
   │  ├─ caches
   │  │  └─ deviceStreaming.xml
   │  ├─ compiler.xml
   │  ├─ deploymentTargetSelector.xml
   │  ├─ gradle.xml
   │  ├─ migrations.xml
   │  ├─ misc.xml
   │  ├─ vcs.xml
   │  └─ workspace.xml
   ├─ app
   │  ├─ build
   │  │  ├─ generated
   │  │  │  ├─ ap_generated_sources
   │  │  │  │  └─ debug
   │  │  │  │     └─ out
   │  │  │  └─ res
   │  │  │     ├─ pngs
   │  │  │     │  └─ debug
   │  │  │     └─ resValues
   │  │  │        ├─ androidTest
   │  │  │        │  └─ debug
   │  │  │        └─ debug
   │  │  ├─ intermediates
   │  │  │  ├─ aar_metadata_check
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ checkDebugAarMetadata
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ checkDebugAndroidTestAarMetadata
   │  │  │  ├─ annotation_processor_list
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ javaPreCompileDebug
   │  │  │  │  │     └─ annotationProcessors.json
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ javaPreCompileDebugAndroidTest
   │  │  │  │        └─ annotationProcessors.json
   │  │  │  ├─ apk
   │  │  │  │  └─ debug
   │  │  │  │     ├─ app-debug.apk
   │  │  │  │     └─ output-metadata.json
   │  │  │  ├─ apk_ide_redirect_file
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ createDebugApkListingFileRedirect
   │  │  │  │  │     └─ redirect.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ createDebugAndroidTestApkListingFileRedirect
   │  │  │  │        └─ redirect.txt
   │  │  │  ├─ app_metadata
   │  │  │  │  └─ debug
   │  │  │  │     └─ writeDebugAppMetadata
   │  │  │  │        └─ app-metadata.properties
   │  │  │  ├─ assets
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugAssets
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestAssets
   │  │  │  ├─ compatible_screen_manifest
   │  │  │  │  └─ debug
   │  │  │  │     └─ createDebugCompatibleScreenManifests
   │  │  │  │        └─ output-metadata.json
   │  │  │  ├─ compile_and_runtime_not_namespaced_r_class_jar
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugResources
   │  │  │  │  │     └─ R.jar
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestResources
   │  │  │  │        └─ R.jar
   │  │  │  ├─ compile_app_classes_jar
   │  │  │  │  └─ debug
   │  │  │  │     └─ bundleDebugClassesToCompileJar
   │  │  │  │        └─ classes.jar
   │  │  │  ├─ compressed_assets
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ compressDebugAssets
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ compressDebugAndroidTestAssets
   │  │  │  │        └─ out
   │  │  │  ├─ data_binding_layout_info_type_merge
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugResources
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestResources
   │  │  │  │        └─ out
   │  │  │  ├─ data_binding_layout_info_type_package
   │  │  │  │  └─ debug
   │  │  │  │     └─ packageDebugResources
   │  │  │  │        └─ out
   │  │  │  ├─ desugar_graph
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  │        ├─ currentProject
   │  │  │  │  │        │  ├─ dirs_bucket_0
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ dirs_bucket_1
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ dirs_bucket_2
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ dirs_bucket_3
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ dirs_bucket_4
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ dirs_bucket_5
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_0
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_1
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_2
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_3
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  ├─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_4
   │  │  │  │  │        │  │  └─ graph.bin
   │  │  │  │  │        │  └─ jar_a9309280d9feaf01141270ba13f79eb4e4b51cf5165196c0b871d63a21e8b856_bucket_5
   │  │  │  │  │        │     └─ graph.bin
   │  │  │  │  │        ├─ externalLibs
   │  │  │  │  │        ├─ mixedScopes
   │  │  │  │  │        └─ otherProjects
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  │           ├─ currentProject
   │  │  │  │           │  ├─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_0
   │  │  │  │           │  │  └─ graph.bin
   │  │  │  │           │  ├─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_1
   │  │  │  │           │  │  └─ graph.bin
   │  │  │  │           │  ├─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_2
   │  │  │  │           │  │  └─ graph.bin
   │  │  │  │           │  ├─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_3
   │  │  │  │           │  │  └─ graph.bin
   │  │  │  │           │  ├─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_4
   │  │  │  │           │  │  └─ graph.bin
   │  │  │  │           │  └─ jar_b529d2f36ccc3f9200c0d5c6efaec2a3a5a74d0239947c03f28cc2f0ec296405_bucket_5
   │  │  │  │           │     └─ graph.bin
   │  │  │  │           ├─ externalLibs
   │  │  │  │           ├─ mixedScopes
   │  │  │  │           └─ otherProjects
   │  │  │  ├─ dex
   │  │  │  │  ├─ debug
   │  │  │  │  │  ├─ mergeExtDexDebug
   │  │  │  │  │  │  └─ classes.dex
   │  │  │  │  │  ├─ mergeLibDexDebug
   │  │  │  │  │  │  ├─ 0
   │  │  │  │  │  │  ├─ 1
   │  │  │  │  │  │  ├─ 10
   │  │  │  │  │  │  ├─ 11
   │  │  │  │  │  │  ├─ 12
   │  │  │  │  │  │  ├─ 13
   │  │  │  │  │  │  ├─ 14
   │  │  │  │  │  │  ├─ 15
   │  │  │  │  │  │  ├─ 2
   │  │  │  │  │  │  ├─ 3
   │  │  │  │  │  │  ├─ 4
   │  │  │  │  │  │  ├─ 5
   │  │  │  │  │  │  ├─ 6
   │  │  │  │  │  │  ├─ 7
   │  │  │  │  │  │  ├─ 8
   │  │  │  │  │  │  └─ 9
   │  │  │  │  │  └─ mergeProjectDexDebug
   │  │  │  │  │     ├─ 0
   │  │  │  │  │     │  └─ classes.dex
   │  │  │  │  │     ├─ 1
   │  │  │  │  │     ├─ 10
   │  │  │  │  │     ├─ 11
   │  │  │  │  │     ├─ 12
   │  │  │  │  │     ├─ 13
   │  │  │  │  │     ├─ 14
   │  │  │  │  │     ├─ 15
   │  │  │  │  │     ├─ 2
   │  │  │  │  │     ├─ 3
   │  │  │  │  │     │  └─ classes.dex
   │  │  │  │  │     ├─ 4
   │  │  │  │  │     ├─ 5
   │  │  │  │  │     ├─ 6
   │  │  │  │  │     ├─ 7
   │  │  │  │  │     ├─ 8
   │  │  │  │  │     └─ 9
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     ├─ mergeExtDexDebugAndroidTest
   │  │  │  │     ├─ mergeLibDexDebugAndroidTest
   │  │  │  │     │  ├─ 0
   │  │  │  │     │  ├─ 1
   │  │  │  │     │  ├─ 10
   │  │  │  │     │  ├─ 11
   │  │  │  │     │  ├─ 12
   │  │  │  │     │  ├─ 13
   │  │  │  │     │  ├─ 14
   │  │  │  │     │  ├─ 15
   │  │  │  │     │  ├─ 2
   │  │  │  │     │  ├─ 3
   │  │  │  │     │  ├─ 4
   │  │  │  │     │  ├─ 5
   │  │  │  │     │  ├─ 6
   │  │  │  │     │  ├─ 7
   │  │  │  │     │  ├─ 8
   │  │  │  │     │  └─ 9
   │  │  │  │     └─ mergeProjectDexDebugAndroidTest
   │  │  │  │        ├─ 0
   │  │  │  │        │  └─ classes.dex
   │  │  │  │        ├─ 1
   │  │  │  │        ├─ 10
   │  │  │  │        ├─ 11
   │  │  │  │        ├─ 12
   │  │  │  │        ├─ 13
   │  │  │  │        ├─ 14
   │  │  │  │        ├─ 15
   │  │  │  │        ├─ 2
   │  │  │  │        ├─ 3
   │  │  │  │        ├─ 4
   │  │  │  │        ├─ 5
   │  │  │  │        ├─ 6
   │  │  │  │        ├─ 7
   │  │  │  │        ├─ 8
   │  │  │  │        └─ 9
   │  │  │  ├─ dex_archive_input_jar_hashes
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ dex_number_of_buckets_file
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ duplicate_classes_check
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ checkDebugDuplicateClasses
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ checkDebugAndroidTestDuplicateClasses
   │  │  │  ├─ external_file_lib_dex_archives
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ desugarDebugFileDependencies
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ desugarDebugAndroidTestFileDependencies
   │  │  │  ├─ external_libs_dex_archive
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ external_libs_dex_archive_with_artifact_transforms
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ incremental
   │  │  │  │  ├─ debug
   │  │  │  │  │  ├─ mergeDebugResources
   │  │  │  │  │  │  ├─ compile-file-map.properties
   │  │  │  │  │  │  ├─ merged.dir
   │  │  │  │  │  │  │  ├─ values
   │  │  │  │  │  │  │  │  └─ values.xml
   │  │  │  │  │  │  │  ├─ values-af
   │  │  │  │  │  │  │  │  └─ values-af.xml
   │  │  │  │  │  │  │  ├─ values-am
   │  │  │  │  │  │  │  │  └─ values-am.xml
   │  │  │  │  │  │  │  ├─ values-ar
   │  │  │  │  │  │  │  │  └─ values-ar.xml
   │  │  │  │  │  │  │  ├─ values-as
   │  │  │  │  │  │  │  │  └─ values-as.xml
   │  │  │  │  │  │  │  ├─ values-az
   │  │  │  │  │  │  │  │  └─ values-az.xml
   │  │  │  │  │  │  │  ├─ values-b+es+419
   │  │  │  │  │  │  │  │  └─ values-b+es+419.xml
   │  │  │  │  │  │  │  ├─ values-b+sr+Latn
   │  │  │  │  │  │  │  │  └─ values-b+sr+Latn.xml
   │  │  │  │  │  │  │  ├─ values-be
   │  │  │  │  │  │  │  │  └─ values-be.xml
   │  │  │  │  │  │  │  ├─ values-bg
   │  │  │  │  │  │  │  │  └─ values-bg.xml
   │  │  │  │  │  │  │  ├─ values-bn
   │  │  │  │  │  │  │  │  └─ values-bn.xml
   │  │  │  │  │  │  │  ├─ values-bs
   │  │  │  │  │  │  │  │  └─ values-bs.xml
   │  │  │  │  │  │  │  ├─ values-ca
   │  │  │  │  │  │  │  │  └─ values-ca.xml
   │  │  │  │  │  │  │  ├─ values-cs
   │  │  │  │  │  │  │  │  └─ values-cs.xml
   │  │  │  │  │  │  │  ├─ values-da
   │  │  │  │  │  │  │  │  └─ values-da.xml
   │  │  │  │  │  │  │  ├─ values-de
   │  │  │  │  │  │  │  │  └─ values-de.xml
   │  │  │  │  │  │  │  ├─ values-el
   │  │  │  │  │  │  │  │  └─ values-el.xml
   │  │  │  │  │  │  │  ├─ values-en-rAU
   │  │  │  │  │  │  │  │  └─ values-en-rAU.xml
   │  │  │  │  │  │  │  ├─ values-en-rCA
   │  │  │  │  │  │  │  │  └─ values-en-rCA.xml
   │  │  │  │  │  │  │  ├─ values-en-rGB
   │  │  │  │  │  │  │  │  └─ values-en-rGB.xml
   │  │  │  │  │  │  │  ├─ values-en-rIN
   │  │  │  │  │  │  │  │  └─ values-en-rIN.xml
   │  │  │  │  │  │  │  ├─ values-en-rXC
   │  │  │  │  │  │  │  │  └─ values-en-rXC.xml
   │  │  │  │  │  │  │  ├─ values-es
   │  │  │  │  │  │  │  │  └─ values-es.xml
   │  │  │  │  │  │  │  ├─ values-es-rUS
   │  │  │  │  │  │  │  │  └─ values-es-rUS.xml
   │  │  │  │  │  │  │  ├─ values-et
   │  │  │  │  │  │  │  │  └─ values-et.xml
   │  │  │  │  │  │  │  ├─ values-eu
   │  │  │  │  │  │  │  │  └─ values-eu.xml
   │  │  │  │  │  │  │  ├─ values-fa
   │  │  │  │  │  │  │  │  └─ values-fa.xml
   │  │  │  │  │  │  │  ├─ values-fi
   │  │  │  │  │  │  │  │  └─ values-fi.xml
   │  │  │  │  │  │  │  ├─ values-fr
   │  │  │  │  │  │  │  │  └─ values-fr.xml
   │  │  │  │  │  │  │  ├─ values-fr-rCA
   │  │  │  │  │  │  │  │  └─ values-fr-rCA.xml
   │  │  │  │  │  │  │  ├─ values-gl
   │  │  │  │  │  │  │  │  └─ values-gl.xml
   │  │  │  │  │  │  │  ├─ values-gu
   │  │  │  │  │  │  │  │  └─ values-gu.xml
   │  │  │  │  │  │  │  ├─ values-h320dp-port-v13
   │  │  │  │  │  │  │  │  └─ values-h320dp-port-v13.xml
   │  │  │  │  │  │  │  ├─ values-h360dp-land-v13
   │  │  │  │  │  │  │  │  └─ values-h360dp-land-v13.xml
   │  │  │  │  │  │  │  ├─ values-h480dp-land-v13
   │  │  │  │  │  │  │  │  └─ values-h480dp-land-v13.xml
   │  │  │  │  │  │  │  ├─ values-h550dp-port-v13
   │  │  │  │  │  │  │  │  └─ values-h550dp-port-v13.xml
   │  │  │  │  │  │  │  ├─ values-h720dp-v13
   │  │  │  │  │  │  │  │  └─ values-h720dp-v13.xml
   │  │  │  │  │  │  │  ├─ values-hdpi-v4
   │  │  │  │  │  │  │  │  └─ values-hdpi-v4.xml
   │  │  │  │  │  │  │  ├─ values-hi
   │  │  │  │  │  │  │  │  └─ values-hi.xml
   │  │  │  │  │  │  │  ├─ values-hr
   │  │  │  │  │  │  │  │  └─ values-hr.xml
   │  │  │  │  │  │  │  ├─ values-hu
   │  │  │  │  │  │  │  │  └─ values-hu.xml
   │  │  │  │  │  │  │  ├─ values-hy
   │  │  │  │  │  │  │  │  └─ values-hy.xml
   │  │  │  │  │  │  │  ├─ values-in
   │  │  │  │  │  │  │  │  └─ values-in.xml
   │  │  │  │  │  │  │  ├─ values-is
   │  │  │  │  │  │  │  │  └─ values-is.xml
   │  │  │  │  │  │  │  ├─ values-it
   │  │  │  │  │  │  │  │  └─ values-it.xml
   │  │  │  │  │  │  │  ├─ values-iw
   │  │  │  │  │  │  │  │  └─ values-iw.xml
   │  │  │  │  │  │  │  ├─ values-ja
   │  │  │  │  │  │  │  │  └─ values-ja.xml
   │  │  │  │  │  │  │  ├─ values-ka
   │  │  │  │  │  │  │  │  └─ values-ka.xml
   │  │  │  │  │  │  │  ├─ values-kk
   │  │  │  │  │  │  │  │  └─ values-kk.xml
   │  │  │  │  │  │  │  ├─ values-km
   │  │  │  │  │  │  │  │  └─ values-km.xml
   │  │  │  │  │  │  │  ├─ values-kn
   │  │  │  │  │  │  │  │  └─ values-kn.xml
   │  │  │  │  │  │  │  ├─ values-ko
   │  │  │  │  │  │  │  │  └─ values-ko.xml
   │  │  │  │  │  │  │  ├─ values-ky
   │  │  │  │  │  │  │  │  └─ values-ky.xml
   │  │  │  │  │  │  │  ├─ values-land
   │  │  │  │  │  │  │  │  └─ values-land.xml
   │  │  │  │  │  │  │  ├─ values-large-v4
   │  │  │  │  │  │  │  │  └─ values-large-v4.xml
   │  │  │  │  │  │  │  ├─ values-ldltr-v21
   │  │  │  │  │  │  │  │  └─ values-ldltr-v21.xml
   │  │  │  │  │  │  │  ├─ values-ldrtl-v17
   │  │  │  │  │  │  │  │  └─ values-ldrtl-v17.xml
   │  │  │  │  │  │  │  ├─ values-lo
   │  │  │  │  │  │  │  │  └─ values-lo.xml
   │  │  │  │  │  │  │  ├─ values-lt
   │  │  │  │  │  │  │  │  └─ values-lt.xml
   │  │  │  │  │  │  │  ├─ values-lv
   │  │  │  │  │  │  │  │  └─ values-lv.xml
   │  │  │  │  │  │  │  ├─ values-mk
   │  │  │  │  │  │  │  │  └─ values-mk.xml
   │  │  │  │  │  │  │  ├─ values-ml
   │  │  │  │  │  │  │  │  └─ values-ml.xml
   │  │  │  │  │  │  │  ├─ values-mn
   │  │  │  │  │  │  │  │  └─ values-mn.xml
   │  │  │  │  │  │  │  ├─ values-mr
   │  │  │  │  │  │  │  │  └─ values-mr.xml
   │  │  │  │  │  │  │  ├─ values-ms
   │  │  │  │  │  │  │  │  └─ values-ms.xml
   │  │  │  │  │  │  │  ├─ values-my
   │  │  │  │  │  │  │  │  └─ values-my.xml
   │  │  │  │  │  │  │  ├─ values-nb
   │  │  │  │  │  │  │  │  └─ values-nb.xml
   │  │  │  │  │  │  │  ├─ values-ne
   │  │  │  │  │  │  │  │  └─ values-ne.xml
   │  │  │  │  │  │  │  ├─ values-night-v8
   │  │  │  │  │  │  │  │  └─ values-night-v8.xml
   │  │  │  │  │  │  │  ├─ values-nl
   │  │  │  │  │  │  │  │  └─ values-nl.xml
   │  │  │  │  │  │  │  ├─ values-or
   │  │  │  │  │  │  │  │  └─ values-or.xml
   │  │  │  │  │  │  │  ├─ values-pa
   │  │  │  │  │  │  │  │  └─ values-pa.xml
   │  │  │  │  │  │  │  ├─ values-pl
   │  │  │  │  │  │  │  │  └─ values-pl.xml
   │  │  │  │  │  │  │  ├─ values-port
   │  │  │  │  │  │  │  │  └─ values-port.xml
   │  │  │  │  │  │  │  ├─ values-pt
   │  │  │  │  │  │  │  │  └─ values-pt.xml
   │  │  │  │  │  │  │  ├─ values-pt-rBR
   │  │  │  │  │  │  │  │  └─ values-pt-rBR.xml
   │  │  │  │  │  │  │  ├─ values-pt-rPT
   │  │  │  │  │  │  │  │  └─ values-pt-rPT.xml
   │  │  │  │  │  │  │  ├─ values-ro
   │  │  │  │  │  │  │  │  └─ values-ro.xml
   │  │  │  │  │  │  │  ├─ values-ru
   │  │  │  │  │  │  │  │  └─ values-ru.xml
   │  │  │  │  │  │  │  ├─ values-si
   │  │  │  │  │  │  │  │  └─ values-si.xml
   │  │  │  │  │  │  │  ├─ values-sk
   │  │  │  │  │  │  │  │  └─ values-sk.xml
   │  │  │  │  │  │  │  ├─ values-sl
   │  │  │  │  │  │  │  │  └─ values-sl.xml
   │  │  │  │  │  │  │  ├─ values-small-v4
   │  │  │  │  │  │  │  │  └─ values-small-v4.xml
   │  │  │  │  │  │  │  ├─ values-sq
   │  │  │  │  │  │  │  │  └─ values-sq.xml
   │  │  │  │  │  │  │  ├─ values-sr
   │  │  │  │  │  │  │  │  └─ values-sr.xml
   │  │  │  │  │  │  │  ├─ values-sv
   │  │  │  │  │  │  │  │  └─ values-sv.xml
   │  │  │  │  │  │  │  ├─ values-sw
   │  │  │  │  │  │  │  │  └─ values-sw.xml
   │  │  │  │  │  │  │  ├─ values-sw600dp-v13
   │  │  │  │  │  │  │  │  └─ values-sw600dp-v13.xml
   │  │  │  │  │  │  │  ├─ values-ta
   │  │  │  │  │  │  │  │  └─ values-ta.xml
   │  │  │  │  │  │  │  ├─ values-te
   │  │  │  │  │  │  │  │  └─ values-te.xml
   │  │  │  │  │  │  │  ├─ values-th
   │  │  │  │  │  │  │  │  └─ values-th.xml
   │  │  │  │  │  │  │  ├─ values-tl
   │  │  │  │  │  │  │  │  └─ values-tl.xml
   │  │  │  │  │  │  │  ├─ values-tr
   │  │  │  │  │  │  │  │  └─ values-tr.xml
   │  │  │  │  │  │  │  ├─ values-uk
   │  │  │  │  │  │  │  │  └─ values-uk.xml
   │  │  │  │  │  │  │  ├─ values-ur
   │  │  │  │  │  │  │  │  └─ values-ur.xml
   │  │  │  │  │  │  │  ├─ values-uz
   │  │  │  │  │  │  │  │  └─ values-uz.xml
   │  │  │  │  │  │  │  ├─ values-v16
   │  │  │  │  │  │  │  │  └─ values-v16.xml
   │  │  │  │  │  │  │  ├─ values-v17
   │  │  │  │  │  │  │  │  └─ values-v17.xml
   │  │  │  │  │  │  │  ├─ values-v18
   │  │  │  │  │  │  │  │  └─ values-v18.xml
   │  │  │  │  │  │  │  ├─ values-v21
   │  │  │  │  │  │  │  │  └─ values-v21.xml
   │  │  │  │  │  │  │  ├─ values-v22
   │  │  │  │  │  │  │  │  └─ values-v22.xml
   │  │  │  │  │  │  │  ├─ values-v23
   │  │  │  │  │  │  │  │  └─ values-v23.xml
   │  │  │  │  │  │  │  ├─ values-v24
   │  │  │  │  │  │  │  │  └─ values-v24.xml
   │  │  │  │  │  │  │  ├─ values-v25
   │  │  │  │  │  │  │  │  └─ values-v25.xml
   │  │  │  │  │  │  │  ├─ values-v26
   │  │  │  │  │  │  │  │  └─ values-v26.xml
   │  │  │  │  │  │  │  ├─ values-v28
   │  │  │  │  │  │  │  │  └─ values-v28.xml
   │  │  │  │  │  │  │  ├─ values-v31
   │  │  │  │  │  │  │  │  └─ values-v31.xml
   │  │  │  │  │  │  │  ├─ values-v34
   │  │  │  │  │  │  │  │  └─ values-v34.xml
   │  │  │  │  │  │  │  ├─ values-vi
   │  │  │  │  │  │  │  │  └─ values-vi.xml
   │  │  │  │  │  │  │  ├─ values-w320dp-land-v13
   │  │  │  │  │  │  │  │  └─ values-w320dp-land-v13.xml
   │  │  │  │  │  │  │  ├─ values-w360dp-port-v13
   │  │  │  │  │  │  │  │  └─ values-w360dp-port-v13.xml
   │  │  │  │  │  │  │  ├─ values-w400dp-port-v13
   │  │  │  │  │  │  │  │  └─ values-w400dp-port-v13.xml
   │  │  │  │  │  │  │  ├─ values-w600dp-land-v13
   │  │  │  │  │  │  │  │  └─ values-w600dp-land-v13.xml
   │  │  │  │  │  │  │  ├─ values-watch-v20
   │  │  │  │  │  │  │  │  └─ values-watch-v20.xml
   │  │  │  │  │  │  │  ├─ values-watch-v21
   │  │  │  │  │  │  │  │  └─ values-watch-v21.xml
   │  │  │  │  │  │  │  ├─ values-xlarge-v4
   │  │  │  │  │  │  │  │  └─ values-xlarge-v4.xml
   │  │  │  │  │  │  │  ├─ values-zh-rCN
   │  │  │  │  │  │  │  │  └─ values-zh-rCN.xml
   │  │  │  │  │  │  │  ├─ values-zh-rHK
   │  │  │  │  │  │  │  │  └─ values-zh-rHK.xml
   │  │  │  │  │  │  │  ├─ values-zh-rTW
   │  │  │  │  │  │  │  │  └─ values-zh-rTW.xml
   │  │  │  │  │  │  │  └─ values-zu
   │  │  │  │  │  │  │     └─ values-zu.xml
   │  │  │  │  │  │  ├─ merger.xml
   │  │  │  │  │  │  └─ stripped.dir
   │  │  │  │  │  └─ packageDebugResources
   │  │  │  │  │     ├─ compile-file-map.properties
   │  │  │  │  │     ├─ merged.dir
   │  │  │  │  │     │  └─ values
   │  │  │  │  │     │     └─ values.xml
   │  │  │  │  │     ├─ merger.xml
   │  │  │  │  │     └─ stripped.dir
   │  │  │  │  ├─ debug-mergeJavaRes
   │  │  │  │  │  ├─ merge-state
   │  │  │  │  │  └─ zip-cache
   │  │  │  │  │     ├─ +LZrz9IO5YG76wSgnXHGoiFghbU=
   │  │  │  │  │     ├─ +Sxa0qMq87WbazoXNHtHkMIWaVY=
   │  │  │  │  │     ├─ 24rDEm78LR5VMoIfqdE0ioCXGyw=
   │  │  │  │  │     ├─ 4XaQl5Vls2FzQqf3fjLMcLqFOMA=
   │  │  │  │  │     ├─ 8chvWNdAhXmGRmkU5q22EtIXxaU=
   │  │  │  │  │     ├─ 8xGdyVIUaNjAmZ4F+mDYY9QROTI=
   │  │  │  │  │     ├─ A1dCX1G6GQFOL0PA1eSh+3HVrSE=
   │  │  │  │  │     ├─ aPAQ7mE4KojtzM3Cl+TX28v0DN8=
   │  │  │  │  │     ├─ bctxPeGspjuuVH8F1e3IJw4kt4w=
   │  │  │  │  │     ├─ BKPD3qODrvxFsmNyXeFT32GpGJU=
   │  │  │  │  │     ├─ BtAJRSBMF4ncCdU10s19fT0aKt4=
   │  │  │  │  │     ├─ CClorDNuK3dUWhpSW_BhGGlVRhk=
   │  │  │  │  │     ├─ Cf5RMS80ZqbT_gpEIHsGa_KeMwE=
   │  │  │  │  │     ├─ cJWq0qu+vOQcCkLFjTqKINpPbqc=
   │  │  │  │  │     ├─ cZt3EnWdCtkm7TtjP7ErG26umyY=
   │  │  │  │  │     ├─ E5SuGFet9KtJ8xLoqPHiHjhqfrs=
   │  │  │  │  │     ├─ EqMl1LXWD_4lYRj1lx7eVZBzBeA=
   │  │  │  │  │     ├─ EWDatzCmkjkxzzzvpVyPd_Km6Rc=
   │  │  │  │  │     ├─ F9Z1mVuhP8sBOuvF5fHej40deTc=
   │  │  │  │  │     ├─ GHMFpupQo16Te+TPe6Nrsu0HB30=
   │  │  │  │  │     ├─ gQjD4kFOKievwe5ngEg9x3NphiA=
   │  │  │  │  │     ├─ H+aYe1X6XpUxvWFzlzLvqjv57c4=
   │  │  │  │  │     ├─ hPFxzUIqRCXlIBy_wNz53DKb9Ac=
   │  │  │  │  │     ├─ HUX69Wtyu6gn1GpR03CS3ak9c+U=
   │  │  │  │  │     ├─ j0Isv9LfJ+Vm7Jx7Q4TzT656gbU=
   │  │  │  │  │     ├─ JdPJdCktmQZCKzf1Z1J_6ADp_ps=
   │  │  │  │  │     ├─ KunsmrmJbTTfYjxnEO1UTr_8sNA=
   │  │  │  │  │     ├─ lHQ2pSEcRSxxxtCvCX62ermycrM=
   │  │  │  │  │     ├─ Lu1FYFsiitgzHipsrk_SCJSm_6k=
   │  │  │  │  │     ├─ M5FBMG6e6MZk5p1kbtN_LLMar1Q=
   │  │  │  │  │     ├─ MW2q7RrVDUCAS_irdBZtXs3kqmY=
   │  │  │  │  │     ├─ na859SyQRA2GN7VfGwCofzCJI28=
   │  │  │  │  │     ├─ nf8my73yNiNWilrlOcA8fCsEluM=
   │  │  │  │  │     ├─ Np49IoOMUnhd_pMehYtfkAutyA4=
   │  │  │  │  │     ├─ nqLdgSXJOni11fKjI7zTZrYsK_8=
   │  │  │  │  │     ├─ NwApVvOPWfESevNoXpSMLwKnLsY=
   │  │  │  │  │     ├─ o+gzGnBj6r7ux4bTj_Z6IBJoHc8=
   │  │  │  │  │     ├─ oWnm18nzhz98P0mPflfZ0FHm5EI=
   │  │  │  │  │     ├─ pfM8AZFicp3Eev1cHBtvdT2xF0s=
   │  │  │  │  │     ├─ pv9ETlqemCQb9HNf2k5y9_lHbcw=
   │  │  │  │  │     ├─ Q0MHlhWnNypj4ThzVhQulHTEjSE=
   │  │  │  │  │     ├─ qBgvv2NH3sHy14S1neVZYXAtDWs=
   │  │  │  │  │     ├─ qLG+MJnNLXnr1ozIS3I3MQFIf5A=
   │  │  │  │  │     ├─ qoObdn36bYJ6cXzPa8sd38D_nNg=
   │  │  │  │  │     ├─ r46KN7hSshPTxFE1+gkgLldB+Rc=
   │  │  │  │  │     ├─ sGhMQBFtGveK+aXcWlJIxetzV6w=
   │  │  │  │  │     ├─ TltP9tGKGJrQFkT2XiBs2FYHpVk=
   │  │  │  │  │     ├─ tzqvQRAbBcjQO0prqd2_KloTPS0=
   │  │  │  │  │     ├─ u9788BF+CkPoC89snaxag_spc8s=
   │  │  │  │  │     ├─ UMfSBtpQrK2LTWJ7T6P_FcthKk0=
   │  │  │  │  │     ├─ uwYBHY_RWy08_536yqmomAqn2rQ=
   │  │  │  │  │     ├─ v_oS6pZq8o682u7Gj5xtrWOd9LM=
   │  │  │  │  │     ├─ wFgBtkhD24sg2GyLsiV5lSPNaJY=
   │  │  │  │  │     ├─ WrL9xHAheaV1j_BYIowvaIPd3ig=
   │  │  │  │  │     ├─ X7KXDiF0xEuQbdT2S7__h2bLlGk=
   │  │  │  │  │     ├─ xXI0jxlP3i28ENIcctXUB6Rgro8=
   │  │  │  │  │     ├─ Y053dWN_sLjVhKIVrx2ssc15sPg=
   │  │  │  │  │     ├─ yidn01SCPevUClltwdhh3Uj4t1A=
   │  │  │  │  │     ├─ ySBJi93Hg64ib8QEMecw0blRsCE=
   │  │  │  │  │     └─ yYFBIaPAbzkntSzt+OYj2oewx4E=
   │  │  │  │  ├─ debugAndroidTest
   │  │  │  │  │  └─ mergeDebugAndroidTestResources
   │  │  │  │  │     ├─ compile-file-map.properties
   │  │  │  │  │     ├─ merged.dir
   │  │  │  │  │     ├─ merger.xml
   │  │  │  │  │     └─ stripped.dir
   │  │  │  │  ├─ debugAndroidTest-mergeJavaRes
   │  │  │  │  │  ├─ merge-state
   │  │  │  │  │  └─ zip-cache
   │  │  │  │  ├─ mergeDebugAndroidTestAssets
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ mergeDebugAndroidTestJniLibFolders
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ mergeDebugAndroidTestShaders
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ mergeDebugAssets
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ mergeDebugJniLibFolders
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ mergeDebugShaders
   │  │  │  │  │  └─ merger.xml
   │  │  │  │  ├─ packageDebug
   │  │  │  │  │  └─ tmp
   │  │  │  │  │     └─ debug
   │  │  │  │  │        ├─ dex-renamer-state.txt
   │  │  │  │  │        └─ zip-cache
   │  │  │  │  │           ├─ androidResources
   │  │  │  │  │           └─ javaResources0
   │  │  │  │  └─ packageDebugAndroidTest
   │  │  │  │     └─ tmp
   │  │  │  │        └─ debugAndroidTest
   │  │  │  │           ├─ dex-renamer-state.txt
   │  │  │  │           └─ zip-cache
   │  │  │  │              ├─ androidResources
   │  │  │  │              └─ javaResources0
   │  │  │  ├─ javac
   │  │  │  │  └─ debug
   │  │  │  │     └─ compileDebugJavaWithJavac
   │  │  │  │        └─ classes
   │  │  │  │           └─ com
   │  │  │  │              └─ flashsms
   │  │  │  │                 └─ gateway
   │  │  │  │                    ├─ App.class
   │  │  │  │                    ├─ BootReceiver.class
   │  │  │  │                    ├─ FlashSmsSender.class
   │  │  │  │                    ├─ GatewayService.class
   │  │  │  │                    ├─ InboundSmsReceiver.class
   │  │  │  │                    ├─ LogAdapter$ViewHolder.class
   │  │  │  │                    ├─ LogAdapter.class
   │  │  │  │                    ├─ LoginActivity.class
   │  │  │  │                    ├─ MainActivity$1.class
   │  │  │  │                    ├─ MainActivity$2.class
   │  │  │  │                    ├─ MainActivity$3.class
   │  │  │  │                    ├─ MainActivity.class
   │  │  │  │                    ├─ MessageLog$1.class
   │  │  │  │                    ├─ MessageLog$Entry.class
   │  │  │  │                    ├─ MessageLog.class
   │  │  │  │                    ├─ OutboundPoller$1.class
   │  │  │  │                    ├─ OutboundPoller.class
   │  │  │  │                    ├─ ServerChecker$Callback.class
   │  │  │  │                    ├─ ServerChecker.class
   │  │  │  │                    ├─ ServerConfig.class
   │  │  │  │                    ├─ ServerStatsPoller$1.class
   │  │  │  │                    ├─ ServerStatsPoller$Callback.class
   │  │  │  │                    ├─ ServerStatsPoller$Stats.class
   │  │  │  │                    ├─ ServerStatsPoller.class
   │  │  │  │                    └─ SmsHttpServer.class
   │  │  │  ├─ local_only_symbol_list
   │  │  │  │  └─ debug
   │  │  │  │     └─ parseDebugLocalResources
   │  │  │  │        └─ R-def.txt
   │  │  │  ├─ manifest_merge_blame_file
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugMainManifest
   │  │  │  │  │     └─ manifest-merger-blame-debug-report.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestManifest
   │  │  │  │        └─ manifest-merger-blame-debug-androidTest-report.txt
   │  │  │  ├─ merged_java_res
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugJavaResource
   │  │  │  │  │     └─ base.jar
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestJavaResource
   │  │  │  │        └─ feature-app.jar
   │  │  │  ├─ merged_jni_libs
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugJniLibFolders
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestJniLibFolders
   │  │  │  │        └─ out
   │  │  │  ├─ merged_manifest
   │  │  │  │  └─ debug
   │  │  │  │     └─ processDebugMainManifest
   │  │  │  │        └─ AndroidManifest.xml
   │  │  │  ├─ merged_manifests
   │  │  │  │  └─ debug
   │  │  │  │     └─ processDebugManifest
   │  │  │  │        ├─ AndroidManifest.xml
   │  │  │  │        └─ output-metadata.json
   │  │  │  ├─ merged_res
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugResources
   │  │  │  │  │     ├─ color_til_stroke.xml.flat
   │  │  │  │  │     ├─ drawable_banner_error_bg.xml.flat
   │  │  │  │  │     ├─ drawable_bg_hero_gradient.xml.flat
   │  │  │  │  │     ├─ drawable_et_bg.xml.flat
   │  │  │  │  │     ├─ drawable_et_bg_readonly.xml.flat
   │  │  │  │  │     ├─ drawable_ic_arrow_forward.xml.flat
   │  │  │  │  │     ├─ drawable_ic_error.xml.flat
   │  │  │  │  │     ├─ drawable_ic_launcher_background.xml.flat
   │  │  │  │  │     ├─ drawable_ic_launcher_foreground.xml.flat
   │  │  │  │  │     ├─ drawable_ic_lock.xml.flat
   │  │  │  │  │     ├─ drawable_ic_person.xml.flat
   │  │  │  │  │     ├─ drawable_ic_port.xml.flat
   │  │  │  │  │     ├─ drawable_ic_server.xml.flat
   │  │  │  │  │     ├─ drawable_ic_settings.xml.flat
   │  │  │  │  │     ├─ drawable_ic_shield_check.xml.flat
   │  │  │  │  │     ├─ drawable_logo.png.flat
   │  │  │  │  │     ├─ drawable_nav_indicator.xml.flat
   │  │  │  │  │     ├─ drawable_shape_circle_accent.xml.flat
   │  │  │  │  │     ├─ drawable_status_icon_bg.xml.flat
   │  │  │  │  │     ├─ drawable_wave_divider.xml.flat
   │  │  │  │  │     ├─ layout_activity_login.xml.flat
   │  │  │  │  │     ├─ layout_activity_main.xml.flat
   │  │  │  │  │     ├─ layout_dialog_server_settings.xml.flat
   │  │  │  │  │     ├─ layout_item_log.xml.flat
   │  │  │  │  │     ├─ mipmap-anydpi-v26_ic_launcher.xml.flat
   │  │  │  │  │     ├─ mipmap-anydpi-v26_ic_launcher_round.xml.flat
   │  │  │  │  │     ├─ mipmap-hdpi_ic_launcher.webp.flat
   │  │  │  │  │     ├─ mipmap-hdpi_ic_launcher_round.webp.flat
   │  │  │  │  │     ├─ mipmap-mdpi_ic_launcher.webp.flat
   │  │  │  │  │     ├─ mipmap-mdpi_ic_launcher_round.webp.flat
   │  │  │  │  │     ├─ mipmap-xhdpi_ic_launcher.webp.flat
   │  │  │  │  │     ├─ mipmap-xhdpi_ic_launcher_round.webp.flat
   │  │  │  │  │     ├─ mipmap-xxhdpi_ic_launcher.webp.flat
   │  │  │  │  │     ├─ mipmap-xxhdpi_ic_launcher_round.webp.flat
   │  │  │  │  │     ├─ mipmap-xxxhdpi_ic_launcher.webp.flat
   │  │  │  │  │     ├─ mipmap-xxxhdpi_ic_launcher_round.webp.flat
   │  │  │  │  │     ├─ values-af_values-af.arsc.flat
   │  │  │  │  │     ├─ values-am_values-am.arsc.flat
   │  │  │  │  │     ├─ values-ar_values-ar.arsc.flat
   │  │  │  │  │     ├─ values-as_values-as.arsc.flat
   │  │  │  │  │     ├─ values-az_values-az.arsc.flat
   │  │  │  │  │     ├─ values-b+es+419_values-b+es+419.arsc.flat
   │  │  │  │  │     ├─ values-b+sr+Latn_values-b+sr+Latn.arsc.flat
   │  │  │  │  │     ├─ values-be_values-be.arsc.flat
   │  │  │  │  │     ├─ values-bg_values-bg.arsc.flat
   │  │  │  │  │     ├─ values-bn_values-bn.arsc.flat
   │  │  │  │  │     ├─ values-bs_values-bs.arsc.flat
   │  │  │  │  │     ├─ values-ca_values-ca.arsc.flat
   │  │  │  │  │     ├─ values-cs_values-cs.arsc.flat
   │  │  │  │  │     ├─ values-da_values-da.arsc.flat
   │  │  │  │  │     ├─ values-de_values-de.arsc.flat
   │  │  │  │  │     ├─ values-el_values-el.arsc.flat
   │  │  │  │  │     ├─ values-en-rAU_values-en-rAU.arsc.flat
   │  │  │  │  │     ├─ values-en-rCA_values-en-rCA.arsc.flat
   │  │  │  │  │     ├─ values-en-rGB_values-en-rGB.arsc.flat
   │  │  │  │  │     ├─ values-en-rIN_values-en-rIN.arsc.flat
   │  │  │  │  │     ├─ values-en-rXC_values-en-rXC.arsc.flat
   │  │  │  │  │     ├─ values-es-rUS_values-es-rUS.arsc.flat
   │  │  │  │  │     ├─ values-es_values-es.arsc.flat
   │  │  │  │  │     ├─ values-et_values-et.arsc.flat
   │  │  │  │  │     ├─ values-eu_values-eu.arsc.flat
   │  │  │  │  │     ├─ values-fa_values-fa.arsc.flat
   │  │  │  │  │     ├─ values-fi_values-fi.arsc.flat
   │  │  │  │  │     ├─ values-fr-rCA_values-fr-rCA.arsc.flat
   │  │  │  │  │     ├─ values-fr_values-fr.arsc.flat
   │  │  │  │  │     ├─ values-gl_values-gl.arsc.flat
   │  │  │  │  │     ├─ values-gu_values-gu.arsc.flat
   │  │  │  │  │     ├─ values-h320dp-port-v13_values-h320dp-port-v13.arsc.flat
   │  │  │  │  │     ├─ values-h360dp-land-v13_values-h360dp-land-v13.arsc.flat
   │  │  │  │  │     ├─ values-h480dp-land-v13_values-h480dp-land-v13.arsc.flat
   │  │  │  │  │     ├─ values-h550dp-port-v13_values-h550dp-port-v13.arsc.flat
   │  │  │  │  │     ├─ values-h720dp-v13_values-h720dp-v13.arsc.flat
   │  │  │  │  │     ├─ values-hdpi-v4_values-hdpi-v4.arsc.flat
   │  │  │  │  │     ├─ values-hi_values-hi.arsc.flat
   │  │  │  │  │     ├─ values-hr_values-hr.arsc.flat
   │  │  │  │  │     ├─ values-hu_values-hu.arsc.flat
   │  │  │  │  │     ├─ values-hy_values-hy.arsc.flat
   │  │  │  │  │     ├─ values-in_values-in.arsc.flat
   │  │  │  │  │     ├─ values-is_values-is.arsc.flat
   │  │  │  │  │     ├─ values-it_values-it.arsc.flat
   │  │  │  │  │     ├─ values-iw_values-iw.arsc.flat
   │  │  │  │  │     ├─ values-ja_values-ja.arsc.flat
   │  │  │  │  │     ├─ values-ka_values-ka.arsc.flat
   │  │  │  │  │     ├─ values-kk_values-kk.arsc.flat
   │  │  │  │  │     ├─ values-km_values-km.arsc.flat
   │  │  │  │  │     ├─ values-kn_values-kn.arsc.flat
   │  │  │  │  │     ├─ values-ko_values-ko.arsc.flat
   │  │  │  │  │     ├─ values-ky_values-ky.arsc.flat
   │  │  │  │  │     ├─ values-land_values-land.arsc.flat
   │  │  │  │  │     ├─ values-large-v4_values-large-v4.arsc.flat
   │  │  │  │  │     ├─ values-ldltr-v21_values-ldltr-v21.arsc.flat
   │  │  │  │  │     ├─ values-ldrtl-v17_values-ldrtl-v17.arsc.flat
   │  │  │  │  │     ├─ values-lo_values-lo.arsc.flat
   │  │  │  │  │     ├─ values-lt_values-lt.arsc.flat
   │  │  │  │  │     ├─ values-lv_values-lv.arsc.flat
   │  │  │  │  │     ├─ values-mk_values-mk.arsc.flat
   │  │  │  │  │     ├─ values-ml_values-ml.arsc.flat
   │  │  │  │  │     ├─ values-mn_values-mn.arsc.flat
   │  │  │  │  │     ├─ values-mr_values-mr.arsc.flat
   │  │  │  │  │     ├─ values-ms_values-ms.arsc.flat
   │  │  │  │  │     ├─ values-my_values-my.arsc.flat
   │  │  │  │  │     ├─ values-nb_values-nb.arsc.flat
   │  │  │  │  │     ├─ values-ne_values-ne.arsc.flat
   │  │  │  │  │     ├─ values-night-v8_values-night-v8.arsc.flat
   │  │  │  │  │     ├─ values-nl_values-nl.arsc.flat
   │  │  │  │  │     ├─ values-or_values-or.arsc.flat
   │  │  │  │  │     ├─ values-pa_values-pa.arsc.flat
   │  │  │  │  │     ├─ values-pl_values-pl.arsc.flat
   │  │  │  │  │     ├─ values-port_values-port.arsc.flat
   │  │  │  │  │     ├─ values-pt-rBR_values-pt-rBR.arsc.flat
   │  │  │  │  │     ├─ values-pt-rPT_values-pt-rPT.arsc.flat
   │  │  │  │  │     ├─ values-pt_values-pt.arsc.flat
   │  │  │  │  │     ├─ values-ro_values-ro.arsc.flat
   │  │  │  │  │     ├─ values-ru_values-ru.arsc.flat
   │  │  │  │  │     ├─ values-si_values-si.arsc.flat
   │  │  │  │  │     ├─ values-sk_values-sk.arsc.flat
   │  │  │  │  │     ├─ values-sl_values-sl.arsc.flat
   │  │  │  │  │     ├─ values-small-v4_values-small-v4.arsc.flat
   │  │  │  │  │     ├─ values-sq_values-sq.arsc.flat
   │  │  │  │  │     ├─ values-sr_values-sr.arsc.flat
   │  │  │  │  │     ├─ values-sv_values-sv.arsc.flat
   │  │  │  │  │     ├─ values-sw600dp-v13_values-sw600dp-v13.arsc.flat
   │  │  │  │  │     ├─ values-sw_values-sw.arsc.flat
   │  │  │  │  │     ├─ values-ta_values-ta.arsc.flat
   │  │  │  │  │     ├─ values-te_values-te.arsc.flat
   │  │  │  │  │     ├─ values-th_values-th.arsc.flat
   │  │  │  │  │     ├─ values-tl_values-tl.arsc.flat
   │  │  │  │  │     ├─ values-tr_values-tr.arsc.flat
   │  │  │  │  │     ├─ values-uk_values-uk.arsc.flat
   │  │  │  │  │     ├─ values-ur_values-ur.arsc.flat
   │  │  │  │  │     ├─ values-uz_values-uz.arsc.flat
   │  │  │  │  │     ├─ values-v16_values-v16.arsc.flat
   │  │  │  │  │     ├─ values-v17_values-v17.arsc.flat
   │  │  │  │  │     ├─ values-v18_values-v18.arsc.flat
   │  │  │  │  │     ├─ values-v21_values-v21.arsc.flat
   │  │  │  │  │     ├─ values-v22_values-v22.arsc.flat
   │  │  │  │  │     ├─ values-v23_values-v23.arsc.flat
   │  │  │  │  │     ├─ values-v24_values-v24.arsc.flat
   │  │  │  │  │     ├─ values-v25_values-v25.arsc.flat
   │  │  │  │  │     ├─ values-v26_values-v26.arsc.flat
   │  │  │  │  │     ├─ values-v28_values-v28.arsc.flat
   │  │  │  │  │     ├─ values-v31_values-v31.arsc.flat
   │  │  │  │  │     ├─ values-v34_values-v34.arsc.flat
   │  │  │  │  │     ├─ values-vi_values-vi.arsc.flat
   │  │  │  │  │     ├─ values-w320dp-land-v13_values-w320dp-land-v13.arsc.flat
   │  │  │  │  │     ├─ values-w360dp-port-v13_values-w360dp-port-v13.arsc.flat
   │  │  │  │  │     ├─ values-w400dp-port-v13_values-w400dp-port-v13.arsc.flat
   │  │  │  │  │     ├─ values-w600dp-land-v13_values-w600dp-land-v13.arsc.flat
   │  │  │  │  │     ├─ values-watch-v20_values-watch-v20.arsc.flat
   │  │  │  │  │     ├─ values-watch-v21_values-watch-v21.arsc.flat
   │  │  │  │  │     ├─ values-xlarge-v4_values-xlarge-v4.arsc.flat
   │  │  │  │  │     ├─ values-zh-rCN_values-zh-rCN.arsc.flat
   │  │  │  │  │     ├─ values-zh-rHK_values-zh-rHK.arsc.flat
   │  │  │  │  │     ├─ values-zh-rTW_values-zh-rTW.arsc.flat
   │  │  │  │  │     ├─ values-zu_values-zu.arsc.flat
   │  │  │  │  │     └─ values_values.arsc.flat
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestResources
   │  │  │  ├─ merged_res_blame_folder
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugResources
   │  │  │  │  │     └─ out
   │  │  │  │  │        ├─ multi-v2
   │  │  │  │  │        │  ├─ mergeDebugResources.json
   │  │  │  │  │        │  ├─ values-af.json
   │  │  │  │  │        │  ├─ values-am.json
   │  │  │  │  │        │  ├─ values-ar.json
   │  │  │  │  │        │  ├─ values-as.json
   │  │  │  │  │        │  ├─ values-az.json
   │  │  │  │  │        │  ├─ values-b+es+419.json
   │  │  │  │  │        │  ├─ values-b+sr+Latn.json
   │  │  │  │  │        │  ├─ values-be.json
   │  │  │  │  │        │  ├─ values-bg.json
   │  │  │  │  │        │  ├─ values-bn.json
   │  │  │  │  │        │  ├─ values-bs.json
   │  │  │  │  │        │  ├─ values-ca.json
   │  │  │  │  │        │  ├─ values-cs.json
   │  │  │  │  │        │  ├─ values-da.json
   │  │  │  │  │        │  ├─ values-de.json
   │  │  │  │  │        │  ├─ values-el.json
   │  │  │  │  │        │  ├─ values-en-rAU.json
   │  │  │  │  │        │  ├─ values-en-rCA.json
   │  │  │  │  │        │  ├─ values-en-rGB.json
   │  │  │  │  │        │  ├─ values-en-rIN.json
   │  │  │  │  │        │  ├─ values-en-rXC.json
   │  │  │  │  │        │  ├─ values-es-rUS.json
   │  │  │  │  │        │  ├─ values-es.json
   │  │  │  │  │        │  ├─ values-et.json
   │  │  │  │  │        │  ├─ values-eu.json
   │  │  │  │  │        │  ├─ values-fa.json
   │  │  │  │  │        │  ├─ values-fi.json
   │  │  │  │  │        │  ├─ values-fr-rCA.json
   │  │  │  │  │        │  ├─ values-fr.json
   │  │  │  │  │        │  ├─ values-gl.json
   │  │  │  │  │        │  ├─ values-gu.json
   │  │  │  │  │        │  ├─ values-h320dp-port-v13.json
   │  │  │  │  │        │  ├─ values-h360dp-land-v13.json
   │  │  │  │  │        │  ├─ values-h480dp-land-v13.json
   │  │  │  │  │        │  ├─ values-h550dp-port-v13.json
   │  │  │  │  │        │  ├─ values-h720dp-v13.json
   │  │  │  │  │        │  ├─ values-hdpi-v4.json
   │  │  │  │  │        │  ├─ values-hi.json
   │  │  │  │  │        │  ├─ values-hr.json
   │  │  │  │  │        │  ├─ values-hu.json
   │  │  │  │  │        │  ├─ values-hy.json
   │  │  │  │  │        │  ├─ values-in.json
   │  │  │  │  │        │  ├─ values-is.json
   │  │  │  │  │        │  ├─ values-it.json
   │  │  │  │  │        │  ├─ values-iw.json
   │  │  │  │  │        │  ├─ values-ja.json
   │  │  │  │  │        │  ├─ values-ka.json
   │  │  │  │  │        │  ├─ values-kk.json
   │  │  │  │  │        │  ├─ values-km.json
   │  │  │  │  │        │  ├─ values-kn.json
   │  │  │  │  │        │  ├─ values-ko.json
   │  │  │  │  │        │  ├─ values-ky.json
   │  │  │  │  │        │  ├─ values-land.json
   │  │  │  │  │        │  ├─ values-large-v4.json
   │  │  │  │  │        │  ├─ values-ldltr-v21.json
   │  │  │  │  │        │  ├─ values-ldrtl-v17.json
   │  │  │  │  │        │  ├─ values-lo.json
   │  │  │  │  │        │  ├─ values-lt.json
   │  │  │  │  │        │  ├─ values-lv.json
   │  │  │  │  │        │  ├─ values-mk.json
   │  │  │  │  │        │  ├─ values-ml.json
   │  │  │  │  │        │  ├─ values-mn.json
   │  │  │  │  │        │  ├─ values-mr.json
   │  │  │  │  │        │  ├─ values-ms.json
   │  │  │  │  │        │  ├─ values-my.json
   │  │  │  │  │        │  ├─ values-nb.json
   │  │  │  │  │        │  ├─ values-ne.json
   │  │  │  │  │        │  ├─ values-night-v8.json
   │  │  │  │  │        │  ├─ values-nl.json
   │  │  │  │  │        │  ├─ values-or.json
   │  │  │  │  │        │  ├─ values-pa.json
   │  │  │  │  │        │  ├─ values-pl.json
   │  │  │  │  │        │  ├─ values-port.json
   │  │  │  │  │        │  ├─ values-pt-rBR.json
   │  │  │  │  │        │  ├─ values-pt-rPT.json
   │  │  │  │  │        │  ├─ values-pt.json
   │  │  │  │  │        │  ├─ values-ro.json
   │  │  │  │  │        │  ├─ values-ru.json
   │  │  │  │  │        │  ├─ values-si.json
   │  │  │  │  │        │  ├─ values-sk.json
   │  │  │  │  │        │  ├─ values-sl.json
   │  │  │  │  │        │  ├─ values-small-v4.json
   │  │  │  │  │        │  ├─ values-sq.json
   │  │  │  │  │        │  ├─ values-sr.json
   │  │  │  │  │        │  ├─ values-sv.json
   │  │  │  │  │        │  ├─ values-sw.json
   │  │  │  │  │        │  ├─ values-sw600dp-v13.json
   │  │  │  │  │        │  ├─ values-ta.json
   │  │  │  │  │        │  ├─ values-te.json
   │  │  │  │  │        │  ├─ values-th.json
   │  │  │  │  │        │  ├─ values-tl.json
   │  │  │  │  │        │  ├─ values-tr.json
   │  │  │  │  │        │  ├─ values-uk.json
   │  │  │  │  │        │  ├─ values-ur.json
   │  │  │  │  │        │  ├─ values-uz.json
   │  │  │  │  │        │  ├─ values-v16.json
   │  │  │  │  │        │  ├─ values-v17.json
   │  │  │  │  │        │  ├─ values-v18.json
   │  │  │  │  │        │  ├─ values-v21.json
   │  │  │  │  │        │  ├─ values-v22.json
   │  │  │  │  │        │  ├─ values-v23.json
   │  │  │  │  │        │  ├─ values-v24.json
   │  │  │  │  │        │  ├─ values-v25.json
   │  │  │  │  │        │  ├─ values-v26.json
   │  │  │  │  │        │  ├─ values-v28.json
   │  │  │  │  │        │  ├─ values-v31.json
   │  │  │  │  │        │  ├─ values-v34.json
   │  │  │  │  │        │  ├─ values-vi.json
   │  │  │  │  │        │  ├─ values-w320dp-land-v13.json
   │  │  │  │  │        │  ├─ values-w360dp-port-v13.json
   │  │  │  │  │        │  ├─ values-w400dp-port-v13.json
   │  │  │  │  │        │  ├─ values-w600dp-land-v13.json
   │  │  │  │  │        │  ├─ values-watch-v20.json
   │  │  │  │  │        │  ├─ values-watch-v21.json
   │  │  │  │  │        │  ├─ values-xlarge-v4.json
   │  │  │  │  │        │  ├─ values-zh-rCN.json
   │  │  │  │  │        │  ├─ values-zh-rHK.json
   │  │  │  │  │        │  ├─ values-zh-rTW.json
   │  │  │  │  │        │  ├─ values-zu.json
   │  │  │  │  │        │  └─ values.json
   │  │  │  │  │        └─ single
   │  │  │  │  │           └─ mergeDebugResources.json
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestResources
   │  │  │  │        └─ out
   │  │  │  ├─ merged_shaders
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mergeDebugShaders
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mergeDebugAndroidTestShaders
   │  │  │  │        └─ out
   │  │  │  ├─ mixed_scope_dex_archive
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ navigation_json
   │  │  │  │  └─ debug
   │  │  │  │     └─ extractDeepLinksDebug
   │  │  │  │        └─ navigation.json
   │  │  │  ├─ nested_resources_validation_report
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ generateDebugResources
   │  │  │  │  │     └─ nestedResourcesValidationReport.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ generateDebugAndroidTestResources
   │  │  │  │        └─ nestedResourcesValidationReport.txt
   │  │  │  ├─ packaged_manifests
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugManifestForPackage
   │  │  │  │  │     ├─ AndroidManifest.xml
   │  │  │  │  │     └─ output-metadata.json
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestManifest
   │  │  │  │        ├─ AndroidManifest.xml
   │  │  │  │        └─ output-metadata.json
   │  │  │  ├─ packaged_res
   │  │  │  │  └─ debug
   │  │  │  │     └─ packageDebugResources
   │  │  │  │        ├─ color
   │  │  │  │        │  └─ til_stroke.xml
   │  │  │  │        ├─ drawable
   │  │  │  │        │  ├─ banner_error_bg.xml
   │  │  │  │        │  ├─ bg_hero_gradient.xml
   │  │  │  │        │  ├─ et_bg.xml
   │  │  │  │        │  ├─ et_bg_readonly.xml
   │  │  │  │        │  ├─ ic_arrow_forward.xml
   │  │  │  │        │  ├─ ic_error.xml
   │  │  │  │        │  ├─ ic_launcher_background.xml
   │  │  │  │        │  ├─ ic_launcher_foreground.xml
   │  │  │  │        │  ├─ ic_lock.xml
   │  │  │  │        │  ├─ ic_person.xml
   │  │  │  │        │  ├─ ic_port.xml
   │  │  │  │        │  ├─ ic_server.xml
   │  │  │  │        │  ├─ ic_settings.xml
   │  │  │  │        │  ├─ ic_shield_check.xml
   │  │  │  │        │  ├─ logo.png
   │  │  │  │        │  ├─ nav_indicator.xml
   │  │  │  │        │  ├─ shape_circle_accent.xml
   │  │  │  │        │  ├─ status_icon_bg.xml
   │  │  │  │        │  └─ wave_divider.xml
   │  │  │  │        ├─ layout
   │  │  │  │        │  ├─ activity_login.xml
   │  │  │  │        │  ├─ activity_main.xml
   │  │  │  │        │  ├─ dialog_server_settings.xml
   │  │  │  │        │  └─ item_log.xml
   │  │  │  │        ├─ mipmap-anydpi-v26
   │  │  │  │        │  ├─ ic_launcher.xml
   │  │  │  │        │  └─ ic_launcher_round.xml
   │  │  │  │        ├─ mipmap-hdpi-v4
   │  │  │  │        │  ├─ ic_launcher.webp
   │  │  │  │        │  └─ ic_launcher_round.webp
   │  │  │  │        ├─ mipmap-mdpi-v4
   │  │  │  │        │  ├─ ic_launcher.webp
   │  │  │  │        │  └─ ic_launcher_round.webp
   │  │  │  │        ├─ mipmap-xhdpi-v4
   │  │  │  │        │  ├─ ic_launcher.webp
   │  │  │  │        │  └─ ic_launcher_round.webp
   │  │  │  │        ├─ mipmap-xxhdpi-v4
   │  │  │  │        │  ├─ ic_launcher.webp
   │  │  │  │        │  └─ ic_launcher_round.webp
   │  │  │  │        ├─ mipmap-xxxhdpi-v4
   │  │  │  │        │  ├─ ic_launcher.webp
   │  │  │  │        │  └─ ic_launcher_round.webp
   │  │  │  │        └─ values
   │  │  │  │           └─ values.xml
   │  │  │  ├─ processed_res
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugResources
   │  │  │  │  │     └─ out
   │  │  │  │  │        ├─ output-metadata.json
   │  │  │  │  │        └─ resources-debug.ap_
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestResources
   │  │  │  │        └─ out
   │  │  │  │           ├─ output-metadata.json
   │  │  │  │           └─ resources.ap_
   │  │  │  ├─ project_dex_archive
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_0.jar
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_1.jar
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_2.jar
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_3.jar
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_4.jar
   │  │  │  │  │        ├─ 9ca2fb6fe547a785bf162de65ddd9b69f2867a0cdd1b5e658da65c9e06a38332_5.jar
   │  │  │  │  │        └─ com
   │  │  │  │  │           └─ flashsms
   │  │  │  │  │              └─ gateway
   │  │  │  │  │                 ├─ App.dex
   │  │  │  │  │                 ├─ BootReceiver.dex
   │  │  │  │  │                 ├─ FlashSmsSender.dex
   │  │  │  │  │                 ├─ GatewayService.dex
   │  │  │  │  │                 ├─ InboundSmsReceiver.dex
   │  │  │  │  │                 ├─ LogAdapter$ViewHolder.dex
   │  │  │  │  │                 ├─ LogAdapter.dex
   │  │  │  │  │                 ├─ LoginActivity.dex
   │  │  │  │  │                 ├─ MainActivity$1.dex
   │  │  │  │  │                 ├─ MainActivity$2.dex
   │  │  │  │  │                 ├─ MainActivity$3.dex
   │  │  │  │  │                 ├─ MainActivity.dex
   │  │  │  │  │                 ├─ MessageLog$1.dex
   │  │  │  │  │                 ├─ MessageLog$Entry.dex
   │  │  │  │  │                 ├─ MessageLog.dex
   │  │  │  │  │                 ├─ OutboundPoller$1.dex
   │  │  │  │  │                 ├─ OutboundPoller.dex
   │  │  │  │  │                 ├─ ServerChecker$Callback.dex
   │  │  │  │  │                 ├─ ServerChecker.dex
   │  │  │  │  │                 ├─ ServerConfig.dex
   │  │  │  │  │                 ├─ ServerStatsPoller$1.dex
   │  │  │  │  │                 ├─ ServerStatsPoller$Callback.dex
   │  │  │  │  │                 ├─ ServerStatsPoller$Stats.dex
   │  │  │  │  │                 ├─ ServerStatsPoller.dex
   │  │  │  │  │                 └─ SmsHttpServer.dex
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  │           └─ b164f35b0cbcbab50ca4f44ca988237c3f5e0dcee3e4ef200fbb3a54dd20fb32_1.jar
   │  │  │  ├─ runtime_symbol_list
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugResources
   │  │  │  │  │     └─ R.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestResources
   │  │  │  │        └─ R.txt
   │  │  │  ├─ signing_config_versions
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ writeDebugSigningConfigVersions
   │  │  │  │  │     └─ signing-config-versions.json
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ writeDebugAndroidTestSigningConfigVersions
   │  │  │  │        └─ signing-config-versions.json
   │  │  │  ├─ source_set_path_map
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ mapDebugSourceSetPaths
   │  │  │  │  │     └─ file-map.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ mapDebugAndroidTestSourceSetPaths
   │  │  │  │        └─ file-map.txt
   │  │  │  ├─ stable_resource_ids_file
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugResources
   │  │  │  │  │     └─ stableIds.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestResources
   │  │  │  │        └─ stableIds.txt
   │  │  │  ├─ sub_project_dex_archive
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ dexBuilderDebug
   │  │  │  │  │     └─ out
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ dexBuilderDebugAndroidTest
   │  │  │  │        └─ out
   │  │  │  ├─ symbol_list_with_package_name
   │  │  │  │  ├─ debug
   │  │  │  │  │  └─ processDebugResources
   │  │  │  │  │     └─ package-aware-r.txt
   │  │  │  │  └─ debugAndroidTest
   │  │  │  │     └─ processDebugAndroidTestResources
   │  │  │  ├─ tmp
   │  │  │  │  └─ manifest
   │  │  │  │     └─ androidTest
   │  │  │  │        └─ debug
   │  │  │  └─ validate_signing_config
   │  │  │     ├─ debug
   │  │  │     │  └─ validateSigningDebug
   │  │  │     └─ debugAndroidTest
   │  │  │        └─ validateSigningDebugAndroidTest
   │  │  ├─ outputs
   │  │  │  ├─ apk
   │  │  │  │  ├─ androidTest
   │  │  │  │  │  └─ debug
   │  │  │  │  │     ├─ app-debug-androidTest.apk
   │  │  │  │  │     └─ output-metadata.json
   │  │  │  │  └─ debug
   │  │  │  │     ├─ app-debug.apk
   │  │  │  │     └─ output-metadata.json
   │  │  │  └─ logs
   │  │  │     └─ manifest-merger-debug-report.txt
   │  │  └─ tmp
   │  │     └─ compileDebugJavaWithJavac
   │  │        ├─ compileTransaction
   │  │        │  ├─ backup-dir
   │  │        │  └─ stash-dir
   │  │        │     ├─ GatewayService.class.uniqueId1
   │  │        │     ├─ OutboundPoller$1.class.uniqueId0
   │  │        │     └─ OutboundPoller.class.uniqueId2
   │  │        └─ previous-compilation-data.bin
   │  ├─ build.gradle
   │  ├─ proguard-rules.pro
   │  └─ src
   │     └─ main
   │        ├─ AndroidManifest.xml
   │        ├─ java
   │        │  └─ com
   │        │     └─ flashsms
   │        │        └─ gateway
   │        │           ├─ App.java
   │        │           ├─ BootReceiver.java
   │        │           ├─ FlashSmsSender.java
   │        │           ├─ GatewayService.java
   │        │           ├─ InboundSmsReceiver.java
   │        │           ├─ LogAdapter.java
   │        │           ├─ LoginActivity.java
   │        │           ├─ MainActivity.java
   │        │           ├─ MessageLog.java
   │        │           ├─ OutboundPoller.java
   │        │           ├─ ServerChecker.java
   │        │           ├─ ServerConfig.java
   │        │           ├─ ServerStatsPoller.java
   │        │           ├─ SmsDeliveryReceiver.java
   │        │           └─ SmsHttpServer.java
   │        └─ res
   │           ├─ color
   │           │  └─ til_stroke.xml
   │           ├─ drawable
   │           │  ├─ banner_error_bg.xml
   │           │  ├─ bg_hero_gradient.xml
   │           │  ├─ et_bg.xml
   │           │  ├─ et_bg_readonly.xml
   │           │  ├─ ic_arrow_forward.xml
   │           │  ├─ ic_error.xml
   │           │  ├─ ic_launcher_background.xml
   │           │  ├─ ic_launcher_foreground.xml
   │           │  ├─ ic_lock.xml
   │           │  ├─ ic_person.xml
   │           │  ├─ ic_port.xml
   │           │  ├─ ic_server.xml
   │           │  ├─ ic_settings.xml
   │           │  ├─ ic_shield_check.xml
   │           │  ├─ logo.png
   │           │  ├─ nav_indicator.xml
   │           │  ├─ shape_circle_accent.xml
   │           │  ├─ status_icon_bg.xml
   │           │  └─ wave_divider.xml
   │           ├─ layout
   │           │  ├─ activity_login.xml
   │           │  ├─ activity_main.xml
   │           │  ├─ dialog_server_settings.xml
   │           │  └─ item_log.xml
   │           ├─ mipmap-anydpi-v26
   │           │  ├─ ic_launcher.xml
   │           │  └─ ic_launcher_round.xml
   │           ├─ mipmap-hdpi
   │           │  ├─ ic_launcher.webp
   │           │  └─ ic_launcher_round.webp
   │           ├─ mipmap-mdpi
   │           │  ├─ ic_launcher.webp
   │           │  └─ ic_launcher_round.webp
   │           ├─ mipmap-xhdpi
   │           │  ├─ ic_launcher.webp
   │           │  └─ ic_launcher_round.webp
   │           ├─ mipmap-xxhdpi
   │           │  ├─ ic_launcher.webp
   │           │  └─ ic_launcher_round.webp
   │           ├─ mipmap-xxxhdpi
   │           │  ├─ ic_launcher.webp
   │           │  └─ ic_launcher_round.webp
   │           └─ values
   │              ├─ color.xml
   │              ├─ dimens.xml
   │              ├─ strings.xml
   │              └─ themes.xml
   ├─ build.gradle
   ├─ gradle
   │  ├─ gradle
   │  │  └─ wrapper
   │  │     └─ gradle-wrapper.properties
   │  └─ wrapper
   │     └─ gradle-wrapper.properties
   ├─ gradle.properties
   ├─ gradlew
   ├─ gradlew.bat
   ├─ local.properties
   ├─ settings.gradle
   └─ SETUP.bat

```