const scenarioData = {
  // Coordinates near Wuhan Yangtze River Bridge (30.550, 114.289)
  dronePath: [
    [30.552, 114.285],
    [30.551, 114.287],
    [30.550, 114.289],
    [30.548, 114.292] // Alert Location (closer to bridge core)
  ],
  restrictedZone: [
    [30.553, 114.288],
    [30.555, 114.295],
    [30.546, 114.290],
    [30.549, 114.284]
  ]
};

const { createApp, ref, onMounted, onUnmounted, computed } = Vue;

createApp({
  setup() {
    const DEFAULT_EVIDENCE_IMAGE = 'assets/target_vessel_1.jpg';
    const isAlertTriggered = ref(false);
    const showReport = ref(false);
    const isSwapped = ref(false);
    const currentTime = ref('');
    const logs = ref([
      { time: '14:10:05', msg: '无人机巡检至长江核心水域，执行既定航线...', type: 'info' }
    ]);
    const currentPathIdx = ref(0);
    const currentPos = ref({ lat: 0, lng: 0 });
    const aiConfidence = ref('0.94');
    const evidenceSnapshotUrl = ref(DEFAULT_EVIDENCE_IMAGE);

    // Will be populated upon alert
    const eventData = ref({
      lat: '---',
      lng: '---',
      time: '---'
    });

    const hashValue = ref('');

    let timeInterval;
    let map;
    let droneMarker;
    let scanSector;
    let geoFenceCircle;
    let restrictedPolygon;
    let routeLine;
    let illegalVesselMarker;
    let patrolTimer;
    let mapResizeTimers = [];

    const updateTime = () => {
      const now = new Date();
      currentTime.value = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
    };

    const addLog = (msg, type = 'info') => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
      logs.value.unshift({ time: timeStr, msg, type });
      if (logs.value.length > 20) logs.value.pop();
    };

    const toggleSwap = () => {
      isSwapped.value = !isSwapped.value;
      // Invalidate map size frequently during the transition so Leaflet adjusts to the dynamic resizing
      let iterations = 0;
      const resizeInterval = setInterval(() => {
        if (map) map.invalidateSize();
        iterations++;
        if (iterations > 30) clearInterval(resizeInterval); // runs for ~600ms
      }, 20);
    };

    const forceMapResize = () => {
      if (!map) return;
      map.invalidateSize(false);
    };

    const scheduleInitialMapResize = () => {
      mapResizeTimers.forEach((id) => clearTimeout(id));
      mapResizeTimers = [];
      [0, 80, 180, 320, 520, 800].forEach((ms) => {
        const timer = setTimeout(forceMapResize, ms);
        mapResizeTimers.push(timer);
      });
    };

    const initMap = () => {
      // Initialize map centered on start point
      map = L.map('map', {
        zoomControl: false,
        attributionControl: false
      }).setView(scenarioData.dronePath[0], 15);

      // Brighter tactical map: clean base + crisp labels.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      }).addTo(map);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.85
      }).addTo(map);

      // Draw restricted area
      restrictedPolygon = L.polygon(scenarioData.restrictedZone, {
        color: '#FF3366',
        fillColor: '#FF3366',
        fillOpacity: 0.16,
        weight: 2,
        dashArray: '8, 6'
      }).addTo(map);

      // Flight route line
      routeLine = L.polyline(scenarioData.dronePath, {
        color: '#00F0FF',
        weight: 3,
        opacity: 0.85,
        dashArray: '8, 8'
      }).addTo(map);

      // Custom Drone Icon
      const droneIcon = L.divIcon({
        html: `<div class="relative flex items-center justify-center">
                 <div class="w-5 h-5 rounded-full bg-sys-blue animate-ping absolute opacity-60"></div>
                 <div class="w-2.5 h-2.5 rounded-full bg-white z-10 shadow-[0_0_12px_#00F0FF]"></div>
               </div>`,
        className: 'bg-transparent',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      droneMarker = L.marker(scenarioData.dronePath[0], { icon: droneIcon }).addTo(map);
      currentPos.value = { lat: scenarioData.dronePath[0][0], lng: scenarioData.dronePath[0][1] };

      const illegalVesselIcon = L.divIcon({
        html: `<div class="risk-dot"></div>`,
        className: 'risk-dot-wrap',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      illegalVesselMarker = L.marker(scenarioData.dronePath[3], { icon: illegalVesselIcon }).addTo(map);

      // Initial scan sector & coverage circle
      updateScanSector(scenarioData.dronePath[0], '#00F0FF', 0.1);

      // Ensure first paint uses the final container width/height.
      map.whenReady(() => {
        scheduleInitialMapResize();
      });
    };

    const startPatrol = () => {
      if (patrolTimer) clearInterval(patrolTimer);
      let idx = 0;
      patrolTimer = setInterval(() => {
        if (isAlertTriggered.value) return;
        idx = (idx + 1) % scenarioData.dronePath.length;
        const pos = scenarioData.dronePath[idx];
        currentPathIdx.value = idx;
        currentPos.value = { lat: pos[0], lng: pos[1] };
        droneMarker.setLatLng(pos);
        updateScanSector(pos, '#00F0FF', 0.12);
      }, 2200);
    };

    // Update sector & 150m Circular Geofence based on current position
    const updateScanSector = (pos, color, opacity) => {
      if (scanSector) {
        map.removeLayer(scanSector);
      }
      if (geoFenceCircle) {
        map.removeLayer(geoFenceCircle);
      }

      const lat = pos[0];
      const lng = pos[1];

      // 150m Live Geofence Circle
      geoFenceCircle = L.circle([lat, lng], {
        color: color,
        fillColor: color,
        fillOpacity: 0.05,
        weight: 1,
        dashArray: '3, 4',
        radius: 150 // 150 meters
      }).addTo(map);

      const radius = 0.005; // approx 500m logic for the wedge
      const angle = Math.PI / 4; // 45 degrees spread
      const direction = Math.PI / 4; // facing North-East

      const p1 = [lat, lng];
      const p2 = [lat + radius * Math.cos(direction - angle), lng + radius * Math.sin(direction - angle)];
      const p3 = [lat + radius * Math.cos(direction + angle), lng + radius * Math.sin(direction + angle)];

      scanSector = L.polygon([p1, p2, p3], {
        color: color,
        fillColor: color,
        fillOpacity: opacity,
        weight: 1,
        className: 'transition-all duration-300'
      }).addTo(map);
    };

    const startTracking = () => {
      addLog('启动高精度目标追踪模式...', 'info');
      // Mock tracking behavior logic here without moving off the target extensively
      const lat = scenarioData.dronePath[3][0];
      const lng = scenarioData.dronePath[3][1];

      let angle = 0;
      setInterval(() => {
        angle += 0.1;
        const dLat = lat + Math.sin(angle) * 0.0001;
        const dLng = lng + Math.cos(angle) * 0.0001;
        droneMarker.setLatLng([dLat, dLng]);
        currentPos.value = { lat: dLat, lng: dLng };
        updateScanSector([dLat, dLng], '#FF3366', 0.3);
      }, 500);
    };

    const downloadPDF = () => {
      if (window.location.protocol === 'file:') {
        alert("当前以 file:// 打开，浏览器会拦截 PDF 截图导出。\n请先运行 start_demo.bat，然后用 http://127.0.0.1:8000/index.html 打开页面再导出。");
        return;
      }

      const element = document.getElementById('report-content');
      if (!element) return;

      const opt = {
        margin: [10, 10, 10, 10],
        filename: `电子执法笔录_ZFXD_${new Date().getTime()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => {
            const el = clonedDoc.getElementById('report-content');
            if (el) {
              el.style.height = 'max-content';
              el.style.overflow = 'visible';
            }
          }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (window.html2pdf) {
        html2pdf().set(opt).from(element).save().catch(err => {
          alert("导出异常，请检查是否因本地 file:// 协议导致跨域拦截。详细错误：" + err.message);
        });
      } else {
        alert("PDF 下载组件未准备好，请检查网络。");
      }
    };

    const setEvidenceFallback = () => {
      evidenceSnapshotUrl.value = `${DEFAULT_EVIDENCE_IMAGE}?t=${Date.now()}`;
    };

    const captureEvidenceSnapshot = async () => {
      const snapshotUrl = `http://127.0.0.1:5000/snapshot?t=${Date.now()}`;
      try {
        const resp = await fetch(snapshotUrl, { cache: 'no-store' });
        const contentType = resp.headers.get('content-type') || '';
        if (resp.ok && contentType.includes('image')) {
          evidenceSnapshotUrl.value = snapshotUrl;
          return;
        }
      } catch (e) {
        // Intentionally fall through to fallback image.
      }
      setEvidenceFallback();
    };

    const handleEvidenceImageError = () => {
      if (!evidenceSnapshotUrl.value.includes(DEFAULT_EVIDENCE_IMAGE)) {
        setEvidenceFallback();
      }
    };

    const triggerEvent = async () => {
      if (isAlertTriggered.value) return; // Prevent double trigger
      isAlertTriggered.value = true;

      // Capture a fresh still image from backend inference stream for evidence.
      await captureEvidenceSnapshot();

      // Move drone to the alert location immediately
      const alertPos = scenarioData.dronePath[scenarioData.dronePath.length - 1];
      if (patrolTimer) clearInterval(patrolTimer);
      droneMarker.setLatLng(alertPos);
      map.flyTo(alertPos, 16);
      currentPos.value = { lat: alertPos[0], lng: alertPos[1] };

      // Change sector color
      updateScanSector(alertPos, '#FF3366', 0.4);

      // Generate Hash
      const generateHash = () => {
        const chars = '0123456789abcdef';
        let hash = '0x';
        for (let i = 0; i < 64; i++) hash += chars[Math.floor(Math.random() * chars.length)];
        return hash;
      };

      hashValue.value = generateHash();

      // Set Event Data
      const now = new Date();
      eventData.value = {
        lat: alertPos[0].toFixed(6),
        lng: alertPos[1].toFixed(6),
        time: now.toLocaleString('zh-CN', { hour12: false })
      };

      // Logging Flow
      addLog(`AI预警：发现疑似非法作业船只，置信度 ${aiConfidence.value}`, 'alert');

      setTimeout(() => {
        addLog('自动触发定位锁定，坐标获取中...', 'info');
      }, 500);

      setTimeout(() => {
        addLog(`坐标已锁定: [${eventData.value.lng}, ${eventData.value.lat}]`, 'info');
      }, 1000);

      setTimeout(() => {
        addLog('正在生成不可篡改证据链哈希...', 'info');
      }, 1500);

      setTimeout(() => {
        addLog(`哈希录入司法存证节点完成`, 'info');
      }, 2500);
    };

    onMounted(() => {
      timeInterval = setInterval(updateTime, 100);
      initMap();
      scheduleInitialMapResize();
      startPatrol();
      window.addEventListener('resize', forceMapResize);
    });

    onUnmounted(() => {
      clearInterval(timeInterval);
      if (patrolTimer) clearInterval(patrolTimer);
      mapResizeTimers.forEach((id) => clearTimeout(id));
      window.removeEventListener('resize', forceMapResize);
    });

    return {
      isAlertTriggered,
      showReport,
      currentTime,
      logs,
      currentPos,
      currentPathIdx,
      eventData,
      hashValue,
      aiConfidence,
      evidenceSnapshotUrl,
      handleEvidenceImageError,
      triggerEvent,
      startTracking,
      downloadPDF,
      toggleSwap,
      isSwapped
    };
  }
}).mount('#app');
