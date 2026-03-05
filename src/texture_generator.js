import * as THREE from 'three';

// Procedural Texture Generators
export function generateTextures() {
    // Shared parameters
    const size = 512;

    // --- LEVEL 0: Concrete & Street Art ---
    const cFloorCanvas = document.createElement('canvas'); cFloorCanvas.width = cFloorCanvas.height = size;
    const ctxF0 = cFloorCanvas.getContext('2d');
    ctxF0.fillStyle = '#6e6e6e'; ctxF0.fillRect(0,0,size,size);
    for(let i=0;i<2000;i++){ ctxF0.fillStyle = Math.random()>0.5 ? '#666' : '#777'; ctxF0.fillRect(Math.random()*size, Math.random()*size, 2, 2); }
    const floorMap0 = new THREE.CanvasTexture(cFloorCanvas);
    floorMap0.wrapS = floorMap0.wrapT = THREE.RepeatWrapping; floorMap0.repeat.set(1, 1);

    const cWallCanvas = document.createElement('canvas'); cWallCanvas.width = cWallCanvas.height = size;
    const ctxW0 = cWallCanvas.getContext('2d');
    ctxW0.fillStyle = '#888'; ctxW0.fillRect(0,0,size,size);
    // Graffiti
    ctxW0.fillStyle = '#ff0055'; ctxW0.font = 'bold 80px "Inter", sans-serif'; 
    ctxW0.fillText('OwnAlpha', 50, 200);
    ctxW0.fillStyle = '#00ffaa'; ctxW0.fillText('HYPE', 250, 400);
    for(let i=0;i<5000;i++){ ctxW0.fillStyle = Math.random()>0.5 ? '#808080' : '#909090'; ctxW0.fillRect(Math.random()*size, Math.random()*size, 1, 1); } // noise
    const wallMap0 = new THREE.CanvasTexture(cWallCanvas);
    wallMap0.wrapS = wallMap0.wrapT = THREE.RepeatWrapping; wallMap0.repeat.set(1, 1);

    // --- LEVEL 1: Stone Path & Gothic Carvings ---
    const sFloorCanvas = document.createElement('canvas'); sFloorCanvas.width = sFloorCanvas.height = size;
    const ctxF1 = sFloorCanvas.getContext('2d');
    ctxF1.fillStyle = '#333'; ctxF1.fillRect(0,0,size,size);
    // Draw paving stones
    ctxF1.strokeStyle = '#111'; ctxF1.lineWidth = 4;
    for(let y=0; y<size; y+=64) {
        for(let x=0; x<size; x+=64) {
            let offset = (y/64)%2===0 ? 0 : 32;
            ctxF1.strokeRect(x+offset, y, 64, 64);
        }
    }
    const floorMap1 = new THREE.CanvasTexture(sFloorCanvas);
    floorMap1.wrapS = floorMap1.wrapT = THREE.RepeatWrapping; floorMap1.repeat.set(1, 1);

    const sWallCanvas = document.createElement('canvas'); sWallCanvas.width = sWallCanvas.height = size;
    const ctxW1 = sWallCanvas.getContext('2d');
    const sWallEmissive = document.createElement('canvas'); sWallEmissive.width = sWallEmissive.height = size;
    const ctxW1E = sWallEmissive.getContext('2d');
    ctxW1.fillStyle = '#222'; ctxW1.fillRect(0,0,size,size);
    ctxW1E.fillStyle = '#000'; ctxW1E.fillRect(0,0,size,size);
    // Draw runes
    ctxW1E.fillStyle = '#8800ff'; ctxW1E.font = 'bold 100px serif';
    ctxW1.fillStyle = '#444'; ctxW1.font = 'bold 100px serif';
    ctxW1.fillText('☥', 100, 150); ctxW1E.fillText('☥', 100, 150);
    ctxW1.fillText('⛧', 300, 350); ctxW1E.fillText('⛧', 300, 350);
    ctxW1.fillText('♆', 150, 450); ctxW1E.fillText('♆', 150, 450);
    const wallMap1 = new THREE.CanvasTexture(sWallCanvas);
    const wallEmissive1 = new THREE.CanvasTexture(sWallEmissive);
    wallMap1.wrapS = wallMap1.wrapT = THREE.RepeatWrapping; wallMap1.repeat.set(1, 1);
    wallEmissive1.wrapS = wallEmissive1.wrapT = THREE.RepeatWrapping; wallEmissive1.repeat.set(1, 1);

    // --- LEVEL 2: Metal Grating & Cyber-Industrial ---
    const mFloorCanvas = document.createElement('canvas'); mFloorCanvas.width = mFloorCanvas.height = size;
    const ctxF2 = mFloorCanvas.getContext('2d');
    ctxF2.fillStyle = '#111'; ctxF2.fillRect(0,0,size,size);
    ctxF2.strokeStyle = '#444'; ctxF2.lineWidth = 2;
    for(let i=0; i<size; i+=16) {
        ctxF2.beginPath(); ctxF2.moveTo(i, 0); ctxF2.lineTo(i, size); ctxF2.stroke();
        ctxF2.beginPath(); ctxF2.moveTo(0, i); ctxF2.lineTo(size, i); ctxF2.stroke();
    }
    const floorMap2 = new THREE.CanvasTexture(mFloorCanvas);
    floorMap2.wrapS = floorMap2.wrapT = THREE.RepeatWrapping; floorMap2.repeat.set(1, 1);

    const mWallCanvas = document.createElement('canvas'); mWallCanvas.width = mWallCanvas.height = size;
    const ctxW2 = mWallCanvas.getContext('2d');
    const mWallEmissive = document.createElement('canvas'); mWallEmissive.width = mWallEmissive.height = size;
    const ctxW2E = mWallEmissive.getContext('2d');
    ctxW2.fillStyle = '#1a1a1a'; ctxW2.fillRect(0,0,size,size);
    ctxW2E.fillStyle = '#000'; ctxW2E.fillRect(0,0,size,size);
    // Draw neon strips
    ctxW2.fillStyle = '#222'; ctxW2.fillRect(0, 100, size, 20);
    ctxW2E.fillStyle = '#00ffff'; ctxW2E.fillRect(0, 105, size, 10);
    ctxW2.fillStyle = '#222'; ctxW2.fillRect(0, 300, size, 40);
    ctxW2E.fillStyle = '#ff00ff'; ctxW2E.fillRect(0, 310, size, 20);
    
    // Draw panel details
    ctxW2.strokeStyle = '#333'; ctxW2.lineWidth = 4;
    ctxW2.strokeRect(50, 150, 150, 100);
    ctxW2.strokeRect(250, 350, 200, 120);

    const wallMap2 = new THREE.CanvasTexture(mWallCanvas);
    const wallEmissive2 = new THREE.CanvasTexture(mWallEmissive);
    wallMap2.wrapS = wallMap2.wrapT = THREE.RepeatWrapping; wallMap2.repeat.set(1, 1);
    wallEmissive2.wrapS = wallEmissive2.wrapT = THREE.RepeatWrapping; wallEmissive2.repeat.set(1, 1);

    // --- TUNNEL (Transition) ---
    const tWallCanvas = document.createElement('canvas'); tWallCanvas.width = tWallCanvas.height = size;
    const ctxTW = tWallCanvas.getContext('2d');
    ctxTW.fillStyle = '#050505'; ctxTW.fillRect(0,0,size,size);
    ctxTW.strokeStyle = '#ffffff'; ctxTW.lineWidth = 2; // Glowing warp lines
    for(let i=0; i<size; i+=64) {
        ctxTW.beginPath(); ctxTW.moveTo(0, i); ctxTW.lineTo(size, i); ctxTW.stroke();
    }
    const tunnelMap = new THREE.CanvasTexture(tWallCanvas);
    tunnelMap.wrapS = tunnelMap.wrapT = THREE.RepeatWrapping; tunnelMap.repeat.set(1, 1);

    return {
        floors: [floorMap0, floorMap1, floorMap2],
        walls: [
            { map: wallMap0, emissiveMap: null, emissiveColor: 0x000000, roughness: 0.8 },
            { map: wallMap1, emissiveMap: wallEmissive1, emissiveColor: 0xffffff, roughness: 0.9 },
            { map: wallMap2, emissiveMap: wallEmissive2, emissiveColor: 0xffffff, roughness: 0.3 }
        ],
        tunnelMap: tunnelMap
    };
}
