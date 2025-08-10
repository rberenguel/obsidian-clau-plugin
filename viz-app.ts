import * as PIXI from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { UMAP } from 'umap-js';
import { GlowFilter } from '@pixi/filter-glow';

function valueToHexColor(value: number, min: number, max: number): number {
    const ratio = (value - min) / (max - min);
    const r = Math.round(50 + 205 * ratio);
    const g = 80;
    const b = Math.round(50 + 205 * (1 - ratio));
    return (r << 16) + (g << 8) + b;
}

(window as any).renderClauVisualization = async (container: HTMLElement, tooltipEl: HTMLElement, app: any, semanticSearchProvider: any) => {
    try {
        const dataPath = "clau-viz/visualization-data.json";
        if (!(await app.vault.adapter.exists(dataPath))) {
            container.setText("Data file not found."); return;
        }
        const jsonData = await app.vault.adapter.read(dataPath);
        const pointsData = JSON.parse(jsonData);

        const umap = new UMAP({ nComponents: 2, nNeighbors: 15 });
        const embeddings = pointsData.map((p: any) => p.embedding);
        const projection = await umap.fitAsync(embeddings);

        const pixiApp = new PIXI.Application();
        await pixiApp.init({
            resizeTo: container,
            backgroundColor: 0x1e1e1e,
            antialias: true,
        });
        container.appendChild(pixiApp.canvas);

        const viewport = new Viewport({ events: pixiApp.renderer.events });
        pixiApp.stage.addChild(viewport);
        viewport.drag().pinch().wheel().decelerate();

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        projection.forEach(p => {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
        const scale = 80;

        const allPointsGfx: { path: string; gfx: PIXI.Graphics; highlightGfx: PIXI.Graphics }[] = [];

        pointsData.forEach((p: any, i: number) => {
            const pointGfx = new PIXI.Graphics();
            const color = valueToHexColor(projection[i][1], minY, maxY);
            pointGfx.circle(0, 0, 2).fill(color);
            pointGfx.x = (projection[i][0] - minX) * scale;
            pointGfx.y = (projection[i][1] - minY) * scale;
            pointGfx.eventMode = 'static';
            pointGfx.cursor = 'pointer';

            pointGfx.on('pointerover', () => { /* ... unchanged ... */ });
            pointGfx.on('pointerout', () => { /* ... unchanged ... */ });
            pointGfx.on('pointermove', (event) => { /* ... unchanged ... */ });
            pointGfx.on('click', () => app.workspace.openLinkText(p.path, '', false));

            viewport.addChild(pointGfx);

            // Create a dedicated graphics object for the highlight
            const highlightGfx = new PIXI.Graphics();
            highlightGfx.x = pointGfx.x;
            highlightGfx.y = pointGfx.y;
            viewport.addChild(highlightGfx);

            allPointsGfx.push({ path: p.path, gfx: pointGfx, highlightGfx });
        });

        viewport.moveCenter((maxX - minX) * scale / 2, (maxY - minY) * scale / 2);
        viewport.fitWorld();

        // --- NEW: The search function to draw a circle highlight ---
        const search = async (query: string) => {
            // Clear all highlights first
            allPointsGfx.forEach(p => p.highlightGfx.clear());

            if (!query || query.trim().length < 3) {
                return;
            }

            const searchResults = await semanticSearchProvider.search(query);
            const resultPaths = new Set(searchResults.map((r: any) => r.path));

            allPointsGfx.forEach(p => {
                if (resultPaths.has(p.path)) {
                    // Draw a yellow circle with a thin line
                    p.highlightGfx.circle(0, 0, 5).stroke({ width: 1, color: 0xFFFF00 });
                }
            });
        };

        return { pixiApp, search };

    } catch (error) {
        console.error("Clau Viz Error:", error);
        container.setText(`Error: ${error.message}`);
    }
};