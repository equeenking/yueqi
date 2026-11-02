// 触屏手势(对标 iPad 库乐队):长按呼出右键菜单、标尺双指缩放。
// 鼠标路径完全不变(仍走 onContextMenu / 缩放按钮);手势只在 touch/pen 指针上生效。

/** 长按多少毫秒后弹出菜单(库乐队式「按住即出」)。 */
const LONG_PRESS_MS = 450;
/** 按住期间移动超过这个距离(像素)视为滚动/拖拽,取消长按。 */
const MOVE_SLOP = 12;
/** 长按弹过菜单后,这段时间内浏览器补发的 contextmenu 一律吞掉,避免弹两次。 */
const FIRE_GUARD_MS = 300;

/**
 * 长按弹菜单之后,吞掉接下来第一次落在菜单外的指针按下:那一下只用来关菜单,
 * 不再穿透到下面的元素(库乐队行为)。挂在 window 捕获阶段,且排在菜单自己的
 * 关闭监听器之后注册(等一拍),先关菜单、再拦下这一下。
 */
function swallowNextTap() {
  const swallow = (e) => {
    window.removeEventListener('pointerdown', swallow, true);
    if (e.target.closest?.('.context-menu')) return; // 点在菜单里:正常交给菜单
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  setTimeout(() => window.addEventListener('pointerdown', swallow, true), 0);
}

/**
 * 把「长按 = 右键菜单」接到一个已有 onContextMenu 的元素上。
 *
 *   <div {...longPressProps(menu, { onPointerDown: startDrag })} />
 *
 * `openMenu` 是元素现有的 onContextMenu 处理器((e) => void,吃 e.clientX/Y——传给 store.showContextMenu
 * 的那种);`handlers` 里放元素原有的 pointer 处理器,长按不劫持它们,只是顺着调用。
 * 触发时以指针坐标弹菜单,并派发 'gtd-longpress'(detail.pointerId),组件可用它中止该指针已开始的拖拽。
 * 触发后本手势的 click 与下一次落地在菜单外的按下都会被吞掉(只关菜单,不误点元素)。
 */
export function longPressProps(openMenu, handlers = {}) {
  let timer = null;
  let pid = -1;
  let sx = 0;
  let sy = 0;
  let firedAt = 0;
  let suppressClick = false;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; pid = -1; };
  const pass = (name, e) => handlers[name]?.(e);
  return {
    onContextMenu: (e) => {
      if (performance.now() - firedAt < FIRE_GUARD_MS) { e.preventDefault(); e.stopPropagation(); return; }
      openMenu(e);
    },
    onClickCapture: (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerDown: (e) => {
      suppressClick = false;
      pass('onPointerDown', e);
      if (e.pointerType !== 'mouse' && e.button === 0 && !timer) {
        pid = e.pointerId;
        sx = e.clientX;
        sy = e.clientY;
        const el = e.currentTarget;
        timer = setTimeout(() => {
          timer = null;
          firedAt = performance.now();
          suppressClick = true;
          el?.dispatchEvent(new CustomEvent('gtd-longpress', { bubbles: true, detail: { pointerId: pid } }));
          openMenu({ preventDefault() {}, stopPropagation() {}, clientX: sx, clientY: sy });
          swallowNextTap();
          pid = -1;
        }, LONG_PRESS_MS);
      }
    },
    onPointerMove: (e) => {
      pass('onPointerMove', e);
      if (timer != null && e.pointerId === pid && Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_SLOP) cancel();
    },
    onPointerUp: (e) => { pass('onPointerUp', e); if (e.pointerId === pid) cancel(); },
    onPointerCancel: (e) => { pass('onPointerCancel', e); if (e.pointerId === pid) cancel(); }
  };
}

/**
 * 双指捏合缩放,挂在标尺上(库乐队同款:捏标尺缩放时间轴)。get() 返回当前缩放值,set(v) 应用;
 * `scroller` 是横向滚动容器,捏合时保持捏合中点的内容位置不动。返回清理函数。
 * 捏合期间在被挂元素上打 __pinch 标记——元素自己的 React 处理器用 pinching(el) 检查并让位。
 */
export function attachPinchZoom(el, { get, set, min, max, scroller = null }) {
  const pts = new Map(); // pointerId -> {x, y}
  let startDist = 0;
  let startVal = 1;
  let anchor = null; // { clientX, frac }:捏合中点在滚动内容里的位置
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const onDown = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      startDist = dist();
      startVal = get();
      el.__pinch = true;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const midX = ([...pts.values()].reduce((s, p) => s + p.x, 0)) / 2;
        anchor = { clientX: midX, frac: (scroller.scrollLeft + midX - r.left) / Math.max(1, scroller.scrollWidth) };
      }
    }
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && startDist > 0) {
      set(Math.max(min, Math.min(max, startVal * (dist() / startDist))));
      if (scroller && anchor) {
        // 等 React 应用新宽度后再校正滚动位置,中点停在原地
        requestAnimationFrame(() => {
          const r = scroller.getBoundingClientRect();
          scroller.scrollLeft = Math.max(0, anchor.frac * scroller.scrollWidth - (anchor.clientX - r.left));
        });
      }
    }
  };
  const onUp = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) { startDist = 0; anchor = null; }
    if (pts.size === 0) el.__pinch = false;
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.__pinch = false;
  };
}

/** attachPinchZoom 挂的元素是否正在双指捏合(元素自己的处理器应让位)。 */
export const pinching = (el) => !!el?.__pinch;
