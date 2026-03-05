import fs from 'fs';
import * as THREE from 'three';
import { createCanvas } from 'canvas';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { JSDOM } from 'jsdom';

console.log("Setting up JSDOM");
const { window } = new JSDOM();
global.window = window;
global.document = window.document;

console.log("Skipping full parsing due to native dependency hell. Instead returning just the node script that manually extracts scale.");
