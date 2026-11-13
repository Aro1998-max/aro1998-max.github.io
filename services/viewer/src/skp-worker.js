// Разбор SKP в отдельном потоке: страница не подвисает на больших моделях.
import { buildScene, toGLB } from 'openskp';

self.onmessage = (e) => {
  const { buf } = e.data;
  try {
    const scene = buildScene(buf, {
      onProgress: (p) => self.postMessage({ type: 'progress', p }),
    });
    const glb = toGLB(scene, { textures: true });
    // метаданные в порядке примитивов: имя, компонент, тег, путь
    const meta = scene.glbPrimitives.map((p) => { const m = scene.meshIndex[p.geomName] || {}; return { name: m.name, def: m.definitionName, layer: m.layer, path: m.path, pos: m.positionMm, props: m.properties, attrs: m.attributeDictionaries }; });
    self.postMessage({ type: 'done', glb: glb.buffer, meta }, [glb.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
