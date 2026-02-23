/**
 * Human-like Mouse Movements
 * Simulates natural mouse behavior to reduce automation detection
 */

import type { Page } from "puppeteer-core";

interface Point {
  x: number;
  y: number;
}

/**
 * Generate a random number between min and max
 */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate bezier curve control points for natural movement
 */
function generateBezierPoints(start: Point, end: Point): Point[] {
  const points: Point[] = [start];
  
  // Add 2-3 control points for curve
  const numControlPoints = randomBetween(2, 3);
  
  for (let i = 0; i < numControlPoints; i++) {
    const t = (i + 1) / (numControlPoints + 1);
    const baseX = start.x + (end.x - start.x) * t;
    const baseY = start.y + (end.y - start.y) * t;
    
    // Add randomness to control points
    const offsetX = randomBetween(-50, 50);
    const offsetY = randomBetween(-30, 30);
    
    points.push({
      x: Math.max(0, baseX + offsetX),
      y: Math.max(0, baseY + offsetY),
    });
  }
  
  points.push(end);
  return points;
}

/**
 * Interpolate along bezier curve
 */
function bezierInterpolate(points: Point[], t: number): Point {
  if (points.length === 1) return points[0]!;
  
  const newPoints: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    newPoints.push({
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
    });
  }
  
  return bezierInterpolate(newPoints, t);
}

/**
 * Move mouse along a natural curved path
 */
export async function moveMouseNaturally(
  page: Page,
  targetX: number,
  targetY: number,
  options: { steps?: number; duration?: number } = {}
): Promise<void> {
  const { steps = randomBetween(20, 40), duration = randomBetween(300, 600) } = options;
  
  // Get current mouse position (default to random starting point if not set)
  const viewport = page.viewport();
  const startX = randomBetween(100, (viewport?.width || 800) - 100);
  const startY = randomBetween(100, (viewport?.height || 600) - 100);
  
  const start: Point = { x: startX, y: startY };
  const end: Point = { x: targetX, y: targetY };
  
  const bezierPoints = generateBezierPoints(start, end);
  const stepDelay = duration / steps;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Add easing (slow start, fast middle, slow end)
    const easedT = t < 0.5 
      ? 2 * t * t 
      : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    const point = bezierInterpolate(bezierPoints, easedT);
    
    await page.mouse.move(point.x, point.y);
    
    // Variable delay for more natural movement
    const jitter = randomBetween(-5, 5);
    await new Promise((resolve) => setTimeout(resolve, Math.max(5, stepDelay + jitter)));
  }
}

/**
 * Perform random idle mouse movements
 */
export async function randomMouseMovement(page: Page): Promise<void> {
  const viewport = page.viewport();
  const width = viewport?.width || 1280;
  const height = viewport?.height || 800;
  
  // Move to 1-3 random positions
  const movements = randomBetween(1, 3);
  
  for (let i = 0; i < movements; i++) {
    const targetX = randomBetween(100, width - 100);
    const targetY = randomBetween(100, height - 100);
    
    await moveMouseNaturally(page, targetX, targetY);
    
    // Small pause between movements
    await new Promise((resolve) => setTimeout(resolve, randomBetween(100, 300)));
  }
}

/**
 * Move mouse to element before clicking (more natural than instant click)
 */
export async function moveToElementAndClick(
  page: Page,
  selector: string,
  options: { clickDelay?: number } = {}
): Promise<boolean> {
  const { clickDelay = randomBetween(50, 150) } = options;
  
  try {
    const element = await page.$(selector);
    if (!element) return false;
    
    const box = await element.boundingBox();
    if (!box) return false;
    
    // Target slightly random position within element
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
    
    await moveMouseNaturally(page, targetX, targetY);
    
    // Small delay before click
    await new Promise((resolve) => setTimeout(resolve, clickDelay));
    
    await page.mouse.click(targetX, targetY);
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll naturally (not instant)
 */
export async function scrollNaturally(
  page: Page,
  direction: "up" | "down",
  amount: number = randomBetween(100, 300)
): Promise<void> {
  const steps = randomBetween(5, 10);
  const stepAmount = amount / steps;
  const multiplier = direction === "down" ? 1 : -1;
  
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: stepAmount * multiplier });
    await new Promise((resolve) => setTimeout(resolve, randomBetween(20, 50)));
  }
}
