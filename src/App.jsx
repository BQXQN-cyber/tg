import React, { useEffect, useMemo, useRef, useState } from "react";

// 这里开始是你的扫街网站的代码主体
export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 20 }}>
      <h1>扫街参与统计 · Demo</h1>
      <p>这是你的 React 应用的入口。</p>
      <p>点击次数：{count}</p>
      <button onClick={() => setCount(count + 1)}>点我加1</button>
    </div>
  );
}
