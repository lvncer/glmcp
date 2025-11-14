# Tool Usecases

| Tool             | 説明                                     | 使用例                                           |
| ---------------- | ---------------------------------------- | ------------------------------------------------ |
| `list_assets`    | 利用可能なモデル/アニメの一覧取得        | `{ "type": "models" }`                         |
| `load_model`     | モデル(.glb/.gltf)を読み込み             | `{ "filePath": "standard.glb" }`              |
| `load_animation` | 外部アニメ(.glb/.gltf)を読み込み         | `{ "animationPath": "CesiumMan.glb", "animationName": "cesium" }` |
| `play_animation` | 読み込み済みアニメを再生                 | `{ "animationName": "cesium", "loop": true }` |
| `stop_animation` | 再生中のアニメーションを停止             | `{ "fadeOutDuration": 0.2 }`                   |
