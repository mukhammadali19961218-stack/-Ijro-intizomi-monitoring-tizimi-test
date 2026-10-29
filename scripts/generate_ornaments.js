const fs = require('fs');
const path = require('path');

function generateUzbekOrnamentSVG(isLeft = true) {
  const gradId = isLeft ? 'naqshFadeLeft' : 'naqshFadeRight';

  // Fading gradient stops:
  // Fades gently near the outer logo AND near the central title
  // For Left: x=0 (logo) -> x=380 (title)
  // For Right: x=0 (title) -> x=380 (emblem)
  let stops = '';
  if (isLeft) {
    stops = [
      '      <stop offset="0%" stop-color="#93c5fd" stop-opacity="0"/>',
      '      <stop offset="10%" stop-color="#60a5fa" stop-opacity="0.3"/>',
      '      <stop offset="30%" stop-color="#2563eb" stop-opacity="0.7"/>',
      '      <stop offset="60%" stop-color="#3b82f6" stop-opacity="0.65"/>',
      '      <stop offset="85%" stop-color="#60a5fa" stop-opacity="0.3"/>',
      '      <stop offset="100%" stop-color="#bfdbfe" stop-opacity="0"/>'
    ].join('\n');
  } else {
    stops = [
      '      <stop offset="0%" stop-color="#bfdbfe" stop-opacity="0"/>',
      '      <stop offset="15%" stop-color="#60a5fa" stop-opacity="0.3"/>',
      '      <stop offset="40%" stop-color="#3b82f6" stop-opacity="0.65"/>',
      '      <stop offset="70%" stop-color="#2563eb" stop-opacity="0.7"/>',
      '      <stop offset="90%" stop-color="#60a5fa" stop-opacity="0.3"/>',
      '      <stop offset="100%" stop-color="#93c5fd" stop-opacity="0"/>'
    ].join('\n');
  }

  // 16-point vertices for 8-pointed Islamic Girikh star (octagram)
  function makeGirikhStar(cx, cy, R, r) {
    let pts = [];
    for (let k = 0; k < 16; k++) {
      const angle = (k * 22.5 - 90) * Math.PI / 180;
      const rad = (k % 2 === 0) ? R : r;
      const x = (cx + rad * Math.cos(angle)).toFixed(1);
      const y = (cy + rad * Math.sin(angle)).toFixed(1);
      pts.push(`${x},${y}`);
    }
    return `M ${pts.join(' L ')} Z`;
  }

  // Two intersecting squares rotated 45 deg (Rub el Hizb symbol)
  function makeRubElHizb(cx, cy, rad) {
    let s1 = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * 90) * Math.PI / 180;
      s1.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
    }
    let s2 = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * 90 + 45) * Math.PI / 180;
      s2.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
    }
    return `M ${s1.join(' L ')} Z M ${s2.join(' L ')} Z`;
  }

  // Diamond/rhombus
  function makeDiamond(cx, cy, rx, ry) {
    return `M ${cx},${cy - ry} L ${cx + rx},${cy} L ${cx},${cy + ry} L ${cx - rx},${cy} Z`;
  }

  // 7 Primary Medallion Star Clusters across 380px width
  const centers = [26, 78, 130, 182, 234, 286, 338];
  let starsPaths = [];
  let innerPaths = [];
  let rosettePaths = [];
  let circleNodes = [];

  centers.forEach(cx => {
    // Outer 8-pointed star (R=21, r=11.5)
    starsPaths.push(makeGirikhStar(cx, 28, 21, 11.5));
    // Middle Rub el Hizb (rad=11.5)
    innerPaths.push(makeRubElHizb(cx, 28, 11.5));
    // Inner 8-pointed star rosette (R=6.5, r=3.5)
    rosettePaths.push(makeGirikhStar(cx, 28, 6.5, 3.5));
    // Central focal dot
    circleNodes.push(`<circle cx="${cx}" cy="28" r="2.2"/>`);
  });

  // 6 Intermediate Connecting Geometric Modules (x = 52, 104, 156, 208, 260, 312)
  let interPaths = [];
  const midCenters = [52, 104, 156, 208, 260, 312];
  midCenters.forEach(cx => {
    // Intermediate 8-pointed star (R=12.5, r=6.5)
    interPaths.push(makeGirikhStar(cx, 28, 12.5, 6.5));
    // Concentric diamond
    interPaths.push(makeDiamond(cx, 28, 9, 9));
    // Intermediate circle node
    circleNodes.push(`<circle cx="${cx}" cy="28" r="1.6"/>`);
    // Top and bottom diamond florets
    interPaths.push(makeDiamond(cx, 13, 3.5, 3.5));
    interPaths.push(makeDiamond(cx, 43, 3.5, 3.5));
    // Tiny satellite accent dots
    circleNodes.push(`<circle cx="${cx}" cy="13" r="1.1"/>`);
    circleNodes.push(`<circle cx="${cx}" cy="43" r="1.1"/>`);
  });

  // Classic Islamic Geometric Strapwork / Fretwork Interlacing Lines
  let strapworkLines = [];
  // Continuous horizontal decorative rails with fine dashed patterns
  strapworkLines.push('<line x1="6" y1="7" x2="374" y2="7" stroke-width="0.8" stroke-dasharray="3 3"/>');
  strapworkLines.push('<line x1="6" y1="49" x2="374" y2="49" stroke-width="0.8" stroke-dasharray="3 3"/>');
  strapworkLines.push('<line x1="6" y1="28" x2="374" y2="28" stroke-width="0.65" stroke-dasharray="1 5"/>');

  // Intertwining diagonal bands connecting the star tips (traditional girikh lattice)
  let bandPaths = [];
  for (let i = 0; i < centers.length; i++) {
    const cx = centers[i];
    // Connecting diagonal lines from star tips to top/bottom borders
    bandPaths.push(`M ${cx},7 L ${cx - 9},16 L ${cx},28 L ${cx + 9},16 L ${cx},7`);
    bandPaths.push(`M ${cx},49 L ${cx - 9},40 L ${cx},28 L ${cx + 9},40 L ${cx},49`);

    if (i < centers.length - 1) {
      const nextCx = centers[i + 1];
      const midX = (cx + nextCx) / 2;
      // Cross chords linking star tips across mid points
      bandPaths.push(`M ${cx + 14},16 L ${nextCx - 14},40`);
      bandPaths.push(`M ${cx + 14},40 L ${nextCx - 14},16`);
      // Top and bottom apex chevrons (khatam crests)
      bandPaths.push(`M ${cx + 10},7 L ${midX},13 L ${nextCx - 10},7`);
      bandPaths.push(`M ${cx + 10},49 L ${midX},43 L ${nextCx - 10},49`);
    }
  }

  // Outer extension wings
  bandPaths.push('M 26,7 L 14,7 L 6,15 L 6,41 L 14,49 L 26,49');
  bandPaths.push('M 338,7 L 350,7 L 358,15 L 358,41 L 350,49 L 338,49');

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 56" fill="none">',
    '  <defs>',
    `    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">`,
    stops,
    '    </linearGradient>',
    '  </defs>',
    `  <g stroke="url(#${gradId})" stroke-linecap="round" stroke-linejoin="round">`,
    `    <path d="${starsPaths.join(' ')}" fill="none" stroke-width="1.2"/>`,
    `    <path d="${innerPaths.join(' ')}" fill="none" stroke-width="0.9"/>`,
    `    <path d="${rosettePaths.join(' ')}" fill="none" stroke-width="0.85"/>`,
    `    <path d="${interPaths.join(' ')}" fill="none" stroke-width="0.95"/>`,
    `    <path d="${bandPaths.join(' ')}" fill="none" stroke-width="0.85"/>`,
    `    ${strapworkLines.join('\n    ')}`,
    '  </g>',
    `  <g fill="url(#${gradId})">`,
    `    ${circleNodes.join('\n    ')}`,
    '  </g>',
    '</svg>'
  ].join('\n');

  return svg;
}

const leftSvg = generateUzbekOrnamentSVG(true);
const rightSvg = generateUzbekOrnamentSVG(false);

const publicImages = path.join(__dirname, '..', 'public', 'images');
fs.writeFileSync(path.join(publicImages, 'uzbek_ornament_left.svg'), leftSvg, 'utf8');
fs.writeFileSync(path.join(publicImages, 'uzbek_ornament_right.svg'), rightSvg, 'utf8');

console.log('Successfully regenerated uzbek_ornament_left.svg and uzbek_ornament_right.svg (dense 7-cluster pattern, 380px width)');
