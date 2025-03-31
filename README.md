# node-modbus

## Intro

Use TypeScript Implement Modbus TCP/RTU Client/Server Library

## Background

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


## Current Status

- [x] Modbus TCP Client
- [x] Modbus TCP Server
- [x] Modbus RTU Client
- [x] Modbus RTU Server
- [x] Debugger
- [x] CI/CD
- [x] Document

Currently, the main focus is on type declaration. Due to my busy work schedule, updates may be irregular. Collaboration is welcome.
