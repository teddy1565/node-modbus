# node-modbus

## 簡介 Intro

使用TypeScript實作Modbus TCP/RTU Client/Server Library

Use TypeScript Implement Modbus TCP/RTU Client/Server Library

## 開發背景 Background

[node-modbus-serial](https://github.com/yaacov/node-modbus-serial#readme)

應該是一個現存社群上，現有最完善易用的Modbus套件我曾經也為此社群貢獻，但仍存在不少問題，例如

- TS型別定義不完善
  - 這很大程度上造成開發者無法使用編輯器自動補全或型別檢查
  - 雖然具備ModbusTCP/RTU Client/Server的功能，但由於文件不全以及型別不明確，導致開發者需要看source code才能使用
- 底層實現過於臃腫，無法發揮v8完整的效能
  - 許多意義不明的prototype chain修改
  - 大量的新增物件，可以推測在某些情況下會造成GC/OOM/效能低下的問題

為此，打算重新開發Modbus相關的套件

若能成功，可能後續考慮將版權捐贈社群或基金會...等

===

[node-modbus-serial](https://github.com/yaacov/node-modbus-serial#readme)

is probably the most complete and easy-to-use Modbus package in the existing community. I have also contributed to this community, but there are still many issues, such as:

- Incomplete TS type definitions
  - This largely prevents developers from using editor autocompletion or type checking.
  - Although it has Modbus TCP/RTU Client/Server functionality, the lack of documentation and unclear types means that developers need to look at the source code to use it.
- The underlying implementation is too bloated to fully utilize V8's performance.
  - Many meaningless prototype chain modifications.
  - A large number of new objects, which can be inferred to cause GC/OOM/performance issues in certain situations.

For this reason, I plan to redevelop the Modbus-related package.

If successful, I may consider donating the copyright to the community or foundation...etc.


## 目前狀態 Current Status

- [x] Modbus TCP Client
- [x] Modbus TCP Server
- [x] Modbus RTU Client
- [x] Modbus RTU Server
- [x] Debugger
- [x] CI/CD
- [x] Document

目前主要還在型別宣告階段，由於平時工作繁忙，可能會不定期更新，歡迎有人願意協作

Currently, the main focus is on type declaration. Due to my busy work schedule, updates may be irregular. Collaboration is welcome.
