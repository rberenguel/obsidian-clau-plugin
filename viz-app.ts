// viz-app.ts
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

(window as any).renderClauVisualization = async (container: HTMLElement, tooltipEl: HTMLElement, app: any, searchCallback: any, showSearchUI: any, onViewportUpdate: any) => {
    try {
        const dataPath = "clau-viz/visualization-data.json";
        if (!(await app.vault.adapter.exists(dataPath))) {
            container.setText("Data file not found."); return;
        }
        const jsonData = await app.vault.adapter.read(dataPath);
        const pointsData = JSON.parse(jsonData);

        const umap = new UMAP({ nComponents: 2, nNeighbors: 18, minDist: 0.003 });
        const embeddings = pointsData.map((p: any) => p.embedding);
        const projection = await umap.fitAsync(embeddings);

        const pixiApp = new PIXI.Application();
        await pixiApp.init({
            resizeTo: container,
            backgroundColor: 0x000000,
            antialias: true,
        });
        container.appendChild(pixiApp.canvas);

        const viewport = new Viewport({ events: pixiApp.renderer.events });
        pixiApp.stage.addChild(viewport);
        viewport.drag().pinch().wheel().decelerate();

        const highlightContainer = new PIXI.Container();
        // The highlightContainer is now added to the viewport *after* the points.

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        projection.forEach(p => {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
        const scale = 80;

        const allPointsGfx: { path: string; gfx: PIXI.Graphics; title: string; highlightGfx: PIXI.Graphics; x: number; y: number }[] = [];

        pointsData.forEach((p: any, i: number) => {
            const pointGfx = new PIXI.Graphics();
            const color = valueToHexColor(projection[i][1], minY, maxY);
            pointGfx.circle(0, 0, 2).fill(color);
            const x = (projection[i][0] - minX) * scale;
            const y = (projection[i][1] - minY) * scale;
            pointGfx.x = x;
            pointGfx.y = y;
            pointGfx.eventMode = 'static';
            pointGfx.cursor = 'pointer';

            pointGfx.on('pointerover', (event) => {
                tooltipEl.style.display = 'block';
                tooltipEl.innerText = p.title;
            });
            pointGfx.on('pointerout', () => {
                tooltipEl.style.display = 'none';
            });
            pointGfx.on('pointermove', (event) => {
                tooltipEl.style.left = `${event.global.x + 10}px`;
                tooltipEl.style.top = `${event.global.y + 10}px`;
            });
            pointGfx.on('click', () => app.workspace.openLinkText(p.path, '', false));

            viewport.addChild(pointGfx);

            const highlightGfx = new PIXI.Graphics();
            highlightGfx.x = x;
            highlightGfx.y = y;
            highlightContainer.addChild(highlightGfx);

            allPointsGfx.push({ path: p.path, gfx: pointGfx, title: p.title, highlightGfx, x, y });
        });

        // By adding the highlightContainer here, it and all its children will be
        // rendered on top of the points that were added in the loop above.
        viewport.addChild(highlightContainer);

        if (onViewportUpdate) {
            viewport.on('zoomed', (event) => onViewportUpdate(viewport, allPointsGfx));
            viewport.on('moved', (event) => onViewportUpdate(viewport, allPointsGfx));
        }

        viewport.moveCenter((maxX - minX) * scale / 2, (maxY - minY) * scale / 2);
        viewport.fitWorld();

        const search = async (query: string) => {
            allPointsGfx.forEach(p => p.highlightGfx.clear());

            if (!query || query.trim().length < 3) {
                return;
            }
            showSearchUI(true);
            const searchResults = await searchCallback(query, 50);
            showSearchUI(false);
            const resultPaths = new Set(searchResults.map((r: any) => r.path));

            allPointsGfx.forEach(p => {
                if (resultPaths.has(p.path)) {
                    p.highlightGfx.circle(0, 0, 5).stroke({ width: 1, color: 0xFFFF00 });
                }
            });
        };

        return { pixiApp, search, viewport, allPointsGfx };

    } catch (error) {
        console.error("Clau Viz Error:", error);
        container.setText(`Error: ${error.message}`);
    }
};