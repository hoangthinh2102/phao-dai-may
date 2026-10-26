# Pháo Đài Mây

Web game bắn tọa độ theo lượt kiểu Gunny, chơi theo đội 1v1 đến 3v3 trên các đảo mây có địa hình phá được.

## Chạy thử local

```bash
cd phao-dai-may
python3 -m http.server 8080
# mở http://localhost:8080
```

Chơi với bot chạy được ở mọi nơi. Online dùng capability `room` của Claude Artifact, nên chỉ chạy khi mở game trên claude.ai.

## Luật chính

- **Lượt theo đội**: mỗi vòng một đội đi trước (luân phiên), trong đội ai có `delay` thấp hơn đi trước. Đạn, kỹ năng, vật phẩm đều cộng delay.
- **Thời gian**: 20 giây mỗi lượt và 60 giây dự trữ cho cả trận.
- **Thắng**: đội còn người cuối cùng. Rơi xuống nước là bị loại. Từ vòng 10, nước dâng dần.
- **Combo trạng thái**: Ướt cộng Sét gây ×1.8, Đóng Băng cộng vụ nổ gây ×1.5, Lửa gặp Ướt thì bốc hơi, Nước dập lửa, Đánh Dấu nhận thêm 25% sát thương.
- **Choáng** (Búa Đá của Thạch Giáp): lượt kế không đi được, lực bắn lệch nhẹ, bị đẩy xuống đi cuối đội. Sau đó miễn choáng 2 vòng.
- **Sát thương rơi**: rơi quá 300px tính từ điểm cao nhất thì mất 0.9 máu mỗi px vượt ngưỡng, tối đa 350.
- **Thanh lực** chạy qua lại 0 → 100 → 0 khi giữ phím, giống Gunny.
- **Bay** (phím B): cưỡi mây bay theo quỹ đạo và đáp xuống nơi đạn rơi. Bay thay cho lượt bắn, hồi 3 lượt.
- **Đo khoảng cách**: kéo màn hình (hoặc giữ M) để hiện thước đo từ bạn tới con trỏ. Trên đầu mỗi địch luôn có khoảng cách ngang và chênh cao. Đơn vị 1 ô = 100px.
- **Gió**: trong khoảng ±2, đổi nhẹ sau mỗi lượt (thỉnh thoảng đổi hẳn). HUD hiện cả gió lượt trước và mức thay đổi.
- **Mục tiêu**: bấm vào địch hoặc nhấn T để chọn, bấm chỗ trống để nhắm một điểm. Sau mỗi phát bắn có dấu ✕ ở chỗ đạn rơi, kèm "Xa quá / Thiếu … ô".
- **Độ khó ngắm** (`ASSIST` trong `data.js`; khi chơi online thì chủ phòng chọn):
  - Dễ: gợi ý lực đã tính gió, gợi ý góc khi bị chắn, đường đạn dài, bấm vào thanh lực để đặt lực chính xác rồi Enter.
  - Vừa: gợi ý lực chưa tính gió, đường đạn ngắn.
  - Khó: tự tính toàn bộ, không gợi ý, không hiện đường đạn.
- **Thể lực**: mỗi lượt 150 ⚡, dùng chung cho đi bộ (0.25/px), đạn (`st` trong `SHELLS`: đạn đầu của mỗi tướng miễn phí, đạn mạnh 10–35, Bay 40), kỹ năng Q (`st` trong `SKILLS`, 20–30) và đạo cụ. Tuyệt kỹ dùng Nộ. Đi bộ không ăn vào phần thể lực của đạn đang chọn.
- **Đạo cụ bắn** (`TOOLS`): phím 4 là +1 Đạn (35), 5 là +2 Đạn (60), 6 là x3 Tia (50, tỏa ±4°). Dùng chung được như Gunny, ví dụ +2 với x3 là 3 loạt × 3 viên. Sát thương mỗi viên theo `ROUND_MULT` và `FAN_MULT`, gộp trong `toolCombo`.

## Công thức lực (đúng với vật lý trong game)

Vận tốc ra nòng = lực × 14.2, trọng lực 900 px/s², gió tạo gia tốc ngang 26 px/s² mỗi vạch.

- 45°, cùng độ cao, không gió: `Lực = 21.1 × √D` (D tính bằng ô)
- Góc θ, địch cao hơn H ô: `Lực = 14.94 × D ÷ (cos θ × √(D × tan θ − H))`
- Gió ở 45° (gió xuôi dương, ngược âm): `Lực ≈ 21.1 × √(D × (1 − 0.029 × gió))`
- Màn Cách chơi trong game có máy tính lực chính xác (`calcPower` trong `app.js`).
- **Nộ**: tích từ sát thương gây ra hoặc phải nhận. Đầy 100 thì dùng được Tuyệt kỹ.
- **Rương thả dù**: rơi 2 vòng một lần, chứa vật phẩm như Tăng Lực, Bắn Đôi, Hồi Máu, Khiên, Dịch Chuyển.

## Map đặc biệt: Thổ Thần Giao Tranh (map mặc định)

Map cho sự kiện công ty, lấy cảm hứng từ sự kiện "Thổ Thần Giao Tranh" (bộ tộc Gamota). Khi chưa chọn gì, game dùng map này (`SPECIAL_MAP` trong `data.js`). Ở menu và trong phòng chờ, map này có khu vực riêng, tách khỏi các bản đồ thường. Bản đồ ngẫu nhiên chỉ chọn trong các bản đồ thường.

- **Hình ảnh:**
  - Bầu trời: hoàng hôn với cột sáng 7 màu, tia nắng, đèn trời bay lên và chim bay.
  - Phông nền: hai dãy núi đá đỏ. Biển chữ **GAMOTA** khổng lồ phát sáng là logo Gamota thật kèm slogan "GAME IS GOOD" đứng trên cột đá cao. Tượng **Thổ Thần** tạc vào vách núi, mắt phát sáng.
  - Địa hình: đất sét đỏ có vân đá và viền hoa văn zigzag, hình khắc trên vách (mặt trời, xoắn ốc, bàn tay, người).
  - Trang trí: lều bộ lạc, lửa trại, trống, giáo, cờ GAMOTA, và một cổng GAMOTA ở mỗi bãi xuất phát.
  - Giữa map: Totem 12 tầng (12 năm Gamota), phá được, đỉnh gắn bảng GAMOTA. Bảng luôn nằm trên phần Totem còn lại.
- **Logo:** `assets/gamota-logo.png` là logo Gamota chính thức (trắng, nền trong suốt), được tô màu tùy chỗ dùng (`LOGO`, `drawLogo` trong `render.js`). Logo xuất hiện trên biển lớn, bảng Totem, cổng, cờ và banner ở menu. Nơi không có file này, ví dụ bản claude.ai, game dùng biểu tượng và chữ vẽ bằng code.
- **Hiệu năng:** toàn bộ phông nền tĩnh được vẽ sẵn thành một ảnh nửa độ phân giải (`tribeLayers`), nên mỗi khung chỉ cần một lần `drawImage`. Vầng sáng (`glow`), đèn trời và mây dùng ảnh vẽ sẵn. Khi game tự hạ độ phân giải vì máy yếu, đèn trời và chim được tắt.
- **Nhân vật:** mặc áo bộ lạc (mào lông xanh, băng đô theo màu đội, vạch sơn má, dây chuyền tam giác, khố). Mỗi tướng một vai: Bom Bi là Tù Trưởng cầm giáo lớn, Thạch Giáp là Chiến Binh Khiên, Mộc Lan là Nữ Pháp Sư, Lôi Vũ là Người Thổi Tù Và, Hỏa Miêu là Thợ Săn. Người đang tới lượt có cột sáng màu riêng sau lưng và vết nứt phát sáng dưới chân (`drawTribeBody`, `drawTribeAura` trong `render.js`).
- **Cơ chế** (`sim.js`):
  - Có anh em: bắn khi đứng cách đồng đội dưới 160px thì +10% sát thương.
  - Cột sáng: mỗi vòng mọc một cột (tối đa 2 cột cùng lúc). Bước vào để nhận: đỏ +25% sát thương cho phát bắn kế, xanh dương khiên 150, xanh lá hồi 150 máu, vàng +30 Nộ.
  - Tù và trận: cứ 3 vòng gió đổi chiều thật mạnh.
- **Lời chào và lời kết:** đầu trận hiện "Chơi game phải có anh em!", cuối trận hiện "Game is Good!" (slogan hiện tại của Gamota).

## Bản đồ

`MAPS` trong `data.js` khai báo cho mỗi bản đồ: kiểu địa hình (`layout`), bảng màu đất (`pal`), bầu trời (`sky`), chất lỏng bên dưới (`liquid`), trang trí (`decor`) và thời tiết (`ambient`). Hàm sinh địa hình nằm trong `LAYOUTS` của `terrain.js`.

| Bản đồ | Đặc điểm |
|---|---|
| Đảo Mây | Đảo cỏ, cầu gỗ, trời trong |
| Sa Mạc Hoàng Hôn | Đồi cát dài, cột đá đỏ chắn đường bắn thẳng, bụi cát bay |
| Băng Nguyên | Đảo băng, nhũ băng treo, cực quang, tuyết rơi |
| Núi Lửa | Núi lửa giữa bản đồ, biển dung nham, tàn lửa |
| Phế Tích Trên Mây | Bệ đá lơ lửng, cột cổ, cầu treo, đánh theo chiều cao |

Thêm bản đồ mới: thêm một mục vào `MAPS`. Nếu cần hình dạng địa hình mới thì thêm một hàm vào `LAYOUTS`. Kiểu trang trí mới thì vẽ trong `drawDecor` (`render.js`).

## Cấu trúc

| File | Nội dung |
|---|---|
| `index.html` | Giao diện: menu chọn tướng, sảnh, HUD (gió, đồng hồ, thứ tự lượt, bảng điều khiển), CSS |
| `js/data.js` | Luật, **tướng** (`HEROES`), **đạn** (`SHELLS`), kỹ năng, tuyệt kỹ, trạng thái, vật phẩm |
| `js/terrain.js` | Địa hình dạng lưới 2px: sinh đảo đối xứng, khoét hố, đắp ụ, dựng tường, vẽ có tầng đất và cỏ |
| `js/sim.js` | Mô phỏng: lượt, vật lý đạn và tướng, combo, tuyệt kỹ, bot tự tính góc và lực, snapshot mạng |
| `js/render.js` | Bầu trời nhiều lớp, tướng chibi, đạn, hạt hiệu ứng, nước, thanh máu, đường ngắm (bản 2D, và lớp phủ của bản 3D) |
| `js/render3d.js` | Bản 3D (Three.js): đảo dạng khối, đồ trang trí, tướng chibi 3D, đạn 3D, chân dung 3D |
| `js/app.js` | Điều khiển, camera, HUD, âm thanh và nhạc tổng hợp, phòng online (host và client) |

## Đồ hoạ 3D (v2)

- Người chơi chọn **Đồ hoạ: 3D / 2D** ở màn hình chính hoặc khi tạm dừng; đổi được giữa trận, lưu trong `pdm.gfx`. Máy không có WebGL tự dùng 2D. Three.js 0.169 được tải lần đầu khi bật 3D (unpkg, dự phòng jsdelivr).
- Luật chơi, địa hình và mạng vẫn là 2D; bản 3D chỉ thay phần vẽ. Ba lớp: bầu trời (canvas 2D) → thế giới 3D (WebGL) → hiệu ứng, đường ngắm, nhãn (canvas 2D). Camera nhìn thẳng mặt phẳng chơi (z = 0) từ phía trên bằng frustum lệch tâm, nên mặt phẳng đó khớp tuyệt đối với tọa độ 2D.
- Đảo: lưới ô được làm mềm (F, lọc 3×3), vách là đường viền F = 0,5 (marching squares) kéo lùi `SLAB_D`. Mặt trước được tô trên GPU (`FACE_FS`) từ hai texture theo ô: màu riêng của ô (đất giữ vân, chưa có dải cỏ) + F, và độ sâu mịn / vật liệu / cháy xém / đá đã làm mềm. Dải cỏ cắt theo độ sâu mịn, ranh giới đá–đất theo mặt nạ đá đã làm mềm, màu chỉ trộn giữa các ô cùng vật liệu, nên phóng to cũng không lộ bậc thang 2px. Thêm viền mực ~2px ở mép, bóng dưới mép cỏ, vân sần nhẹ, độ bão hoà 0,86 để nhân vật nổi hơn. Alpha-to-coverage + MSAA cho mép mịn. Chỉ các khối 32×32 ô bị nổ mới dựng lại (khoảng 5 ms; dựng cả bản đồ khoảng 25 ms).
- Bóng mềm dưới cây, lều, cột, đèn… là lưới nhỏ bám theo mặt đất (`r3DecorShadows`). Bầu trời phủ một lớp sương nhạt (trừ map Núi Lửa).
- Tướng: dựng từ khối cơ bản (thân hình giọt, tay rảnh, đế giày), mỗi phần chuyển động là một geometry gộp (màu theo đỉnh), tô toon + ánh viền + điểm bóng (kiểu đồ chơi nhựa), viền mực theo màu từng tướng với độ dày tính theo pixel màn hình (đều ở mọi mức zoom). Mặt vẽ bằng `drawFace` lên texture của đầu (có chớp mắt). Hoạt ảnh: thở khi đứng, kéo giãn khi bay, nén khi tiếp đất, giật lùi khi bắn. Bộ đồ bộ lạc trên map Thổ Thần.
- Tranh vẽ AI (`art/`, chỉ ở chế độ 3D): nhân vật, vũ khí, cây/lều/xương rồng, bầu trời từng map và vân đất/đá/cỏ được vẽ bằng FLUX.1-schnell (chạy trên máy, giấy phép Apache-2.0), tách nền trắng và thêm viền mực kiểu sticker. `art/art.json` ghi kích thước, điểm cầm vũ khí (`hand`), điểm nắm (`grip`) và độ dài vũ khí (`len`). Nhân vật là tấm tranh đứng trong cảnh 3D: thở, lắc khi đi, giãn/nén khi bay/tiếp đất, giật khi bắn, lật mặt khi quay; vũ khí là tấm riêng xoay theo góc ngắm. Thiếu tranh nào thì dùng lại mô hình dựng bằng khối. Map Thổ Thần giữ phông nền GAMOTA của sự kiện.
- Camera nghiêng `R3.tilt` (mặc định 1,3) để thấy rõ mặt trên của đảo.
- HUD kiểu 3D (`html.g3`): nút nổi khối, thanh lực dạng ống, thanh dưới gọn hơn (thấp hơn khoảng 30%, ẩn dòng chữ trạng thái); chân dung trong HUD, sảnh và danh sách tướng được chụp từ mô hình 3D.

## Âm thanh (v2)

- Nhạc thích ứng: bộ tuần tự 16 nốt, mỗi map một giọng (thang âm, nhịp, nhạc cụ; Thổ Thần có trống bộ lạc, sáo và tù và), motif 2 ô nhịp tự sáng tác rồi lặp có biến tấu. `SFX.want` (độ căng của trận: lượt bắn, đạn đang bay, máu thấp) thêm trống, bass và bè phụ. Nhạc thắng/thua khi hết trận.
- Không gian theo map (độ vang, hẻm núi có tiếng vọng), âm ở xa bị nghẹt dần, nhạc tự nhỏ lại dưới vụ nổ lớn, âm thanh môi trường theo map, tiếng bước chân theo vật liệu. Âm lượng nhạc và hiệu ứng chỉnh trong màn tạm dừng.

## Thêm tướng mới

1. Thêm loại đạn mới (nếu cần) vào `SHELLS` trong `data.js`. Trường `kind` quyết định vật lý: `std`, `split`, `drill`, `bounce`, `mound`, `gravity`, `heal`, `portal`, `beam`, `sticky`.
2. Thêm tướng vào `HEROES` và `HERO_KEYS`: chọn 3 đạn, 1 kỹ năng (`SKILLS`), 1 tuyệt kỹ (`ULTS`).
3. Nếu tướng có nội tại hoặc kỹ năng mới, xử lý trong `sim.js` (`useSkill`, `fireUlt`, `hitHero`).
4. Thêm cách chọn đạn cho bot trong `botChoose`.
5. Vẽ ngoại hình trong `render.js` (`drawWeapon`, `drawHair`, `drawFace`, `drawHat`).

## Online

- Chủ phòng chạy mô phỏng và gửi snapshot 10 lần mỗi giây, 20 lần khi có thứ đang chuyển động. Snapshot mang mốc giờ thực của chủ phòng (`t`), mã trận (`m`) và số thứ tự (`z`).
- Client báo lại thao tác địa hình và sự kiện cuối cùng đã áp (`k` trong presence). Snapshot chỉ mang những gì còn có người thiếu, nên mất gói không làm lệch địa hình (trung bình khoảng 350 byte mỗi gói, trước đây khoảng 1,4 KB).
- Client vẽ các nhân vật khác lùi lại một chút (khoảng 50 đến 200 ms, tự chỉnh theo độ giật của mạng), nội suy giữa hai snapshot. Đạn được mô phỏng tiếp ở client, sai lệch so với chủ phòng mờ dần thay vì nhảy.
- Lượt của mình: góc, hướng và đi bộ chạy ngay trên máy client (dùng chung hàm `walk` của sim); vị trí của chủ phòng chỉ kéo lại sau khi dừng tay. Ping (đi và về) hiện ở góc trên HUD.
- P2P: ngoài kênh tin cậy của PeerJS, hai bên mở thêm một kênh `negotiated` không giữ thứ tự, không gửi lại (`FAST_ID`) cho snapshot; phần presence còn lại của chủ phòng (sảnh, tên) chỉ gửi khi đổi. Relay: client đo ping qua từng broker và chuyển sang broker nhanh hơn rõ rệt.
- Client gửi trạng thái ngắm (di chuyển, góc, lực đang nạp) và các lệnh (bắn, kỹ năng, vật phẩm, đánh dấu vị trí).
- Client sinh lại địa hình từ `seed`, rồi áp các thao tác khoét hố hoặc đắp đất theo đúng thứ tự.
- Chưa hỗ trợ vào giữa trận. Người rời giữa trận sẽ được bot chơi thay.
- **Ai đang online** (bản Vercel): mỗi tab giữ một presence (tên, tướng, trạng thái, phòng đang mở, lời mời) dạng retained message trên các broker MQTT công cộng, tự xóa khi tab đóng (pagehide) hoặc mất kết nối (last will, khoảng 20 giây). Presence mang mốc giờ `ts` do chính tab ghi và được gửi lại mỗi 15 giây; tab nào im quá 45 giây coi như đã rời. Độ mới chỉ tính theo `ts`, không tin broker: broker giữ bản sao của tab đã chết và đôi khi phát lại như tin mới (đã gặp trên test.mosquitto.org). `ts` cũ hoặc lạ chỉ được chấp nhận khi lần báo sau tăng đúng bằng thời gian thực đã trôi (máy lệch đồng hồ vẫn hiện, bản phát lại thì không). Bản ghi không có `ts` hoặc quá 10 phút bị xóa luôn cho mọi người. Tab báo rời vẫn được giữ thêm 3 giây, để người tải lại trang không bị nhấp nháy. Mỗi trình duyệt có một mã cố định (`pdmUid` trong localStorage), nên nhiều tab hoặc tải lại trang vẫn chỉ tính là một người. Màn hình chính có "N người đang online"; trong phòng chờ có nút "Mời người online" để gửi lời mời. Người được mời (đang ở sảnh hoặc chơi với bot) thấy thẻ mời và vào phòng bằng một chạm. Trên claude.ai tính năng này dùng presence của capability `room`.
- Mời bạn bè: trong sảnh chờ có link `…?room=MÃ`. Ngoài ra, chủ phòng quảng bá phòng qua presence của phòng chung (`open`), nên ai mở game cũng thấy mục "Phòng đang mở" và vào bằng một chạm.

## Deploy (Vercel)

- Bản chạy thật: https://phao-dai-may.vercel.app (project `phao-dai-may` trên Vercel).
- `index.html` viết theo định dạng Claude Artifact (không có `<!doctype>`/`<head>`). `scripts/build.sh` bọc nó thành trang đầy đủ trong `dist/`. Vercel tự chạy script này theo `vercel.json`.
- Deploy lại sau khi sửa code: `npx vercel deploy --prod` (chạy trong thư mục `phao-dai-may`, cần `npx vercel login` một lần).
- Tự cập nhật: mỗi lần build ghi mã phiên bản vào trang (`window.PDM_BUILD`) và `version.json`. Trang đang mở kiểm tra mỗi phút và khi quay lại tab, rồi tự tải lại khi người chơi đang ở màn hình chính (không ở trong phòng hay trong trận). Trước khi tạo hoặc vào phòng cũng kiểm tra một lần. Khi đổi giao thức mạng, tăng `NET_PV` trong `app.js`: client khác phiên bản sẽ được báo tải lại thay vì vào trận lỗi.
- Ngoài claude.ai, chơi online dùng WebRTC qua PeerJS (`js/net-p2p.js`): máy chủ phòng chạy trận và gửi trạng thái thẳng tới người chơi khác. Không cần server riêng. Link mời `?room=MÃ` tự vào phòng.
- Khi hai máy không nối thẳng được (4G, mạng công ty, cùng Wi-Fi trên Chrome), client tự chuyển sang **relay qua MQTT công cộng** (`RELAYS` trong `net-p2p.js`), trễ khoảng 0.25 đến 0.3 giây mỗi chiều. Thêm `?relay=1` vào link để ép dùng relay khi test. Nhật ký kết nối nằm trong `window.__p2plog`.
- TURN riêng (tùy chọn, nhanh hơn relay), đặt biến môi trường cho project trên Vercel rồi deploy lại; `api/turn.js` cấp thông tin TURN cho trình duyệt. TURN mặc định của PeerJS đã ngừng hoạt động.
  - Nhà cung cấp có user/mật khẩu cố định (ví dụ gói miễn phí ExpressTURN): `TURN_URLS` (cách nhau bằng dấu phẩy), `TURN_USERNAME`, `TURN_CREDENTIAL`.
  - Cloudflare Realtime TURN (cần thêm thẻ): `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`.
