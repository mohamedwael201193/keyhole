"use client";
import { useEffect, useRef } from "react";

/** One fullscreen-triangle WebGL field (ogl). Loaded after paint; capped brightness; cursor-reactive parallax. */
export default function ShaderField({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    // Touch devices and reduced motion get one drawn frame (no loop) to save battery and main thread.
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches;
    let raf = 0, alive = true, cleanup = () => {};
    import("ogl").then(({ Renderer, Program, Mesh, Triangle }) => {
      if (!alive) return;
      let renderer;
      try { renderer = new Renderer({ dpr: Math.min(devicePixelRatio, 1.5), alpha: true, antialias: false }); } catch { return; }
      const gl = renderer.gl; if (!gl) return;
      gl.canvas.setAttribute("aria-hidden", "true");
      el.appendChild(gl.canvas);
      const program = new Program(gl, {
        vertex: `attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,0.,1.); }`,
        fragment: `precision highp float; varying vec2 vUv; uniform float uT; uniform vec2 uRes; uniform vec2 uM;
          float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          float star(vec2 uv, float s){ vec2 g=fract(uv)-.5; vec2 id=floor(uv); float r=h(id); if(r>s) return 0.;
            vec2 o=vec2(h(id+1.3),h(id+7.1))-.5; g-=o*.6; float d=length(g);
            float cross=max(0.,.012/abs(g.x)*step(abs(g.y),.18))+max(0.,.012/abs(g.y)*step(abs(g.x),.18));
            float tw=.55+.45*sin(uT*(.6+r*1.7)+r*40.);
            return (smoothstep(.06,0.,d)*1.4+cross*.35)*tw; }
          void main(){ vec2 p=(vUv-.5)*vec2(uRes.x/uRes.y,1.);
            float a=0.;
            a+=star((p+uM*.010)*7.+vec2(0.,uT*.01),.10)*.55;
            a+=star((p+uM*.025)*4.+vec2(3.,uT*.015),.08)*.85;
            a+=star((p+uM*.050)*2.3+vec2(9.,uT*.02),.07);
            float glow=exp(-length(p-vec2(.18,0.)-uM*.03)*2.6)*.10;
            vec3 c=vec3(0.,.925,.592)*(a*.22+glow);
            c=min(c,vec3(.2));
            gl_FragColor=vec4(c, 1.); }`,
        uniforms: { uT: { value: 0 }, uRes: { value: [1, 1] }, uM: { value: [0, 0] } },
      });
      const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
      const resize = () => { renderer.setSize(el.clientWidth, el.clientHeight); program.uniforms.uRes.value = [el.clientWidth, el.clientHeight]; };
      resize(); addEventListener("resize", resize);
      const target = [0, 0], cur = [0, 0];
      const move = (e: PointerEvent) => { target[0] = (e.clientX / innerWidth - .5) * 2; target[1] = -(e.clientY / innerHeight - .5) * 2; };
      addEventListener("pointermove", move, { passive: true });
      const t0 = performance.now();
      const frame = () => {
        cur[0] += (target[0] - cur[0]) * .05; cur[1] += (target[1] - cur[1]) * .05;
        program.uniforms.uM.value = cur; program.uniforms.uT.value = (performance.now() - t0) / 1000;
        renderer.render({ scene: mesh });
        raf = requestAnimationFrame(frame);
      };
      el.dataset.ready = "1";
      if (reduce) renderer.render({ scene: mesh }); else frame();
      cleanup = () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", move); gl.getExtension("WEBGL_lose_context")?.loseContext(); gl.canvas.remove(); };
    });
    return () => { alive = false; cleanup(); };
  }, []);
  return <div ref={host} className={`kh-field ${className}`} aria-hidden="true" />;
}
