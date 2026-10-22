// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
struct Quote { bytes32 orderId; address merchant; address token; uint256 amount; address partner; uint16 referralBps; uint16 cashbackBps; uint256 deadline; }
interface IRouter {
    function token() external view returns (address);
    function settleRecurring(Quote calldata q, address payer) external returns (bytes32);
    function payments(bytes32 hash) external view returns (address merchant, address payer, uint256 amount, uint256 timestamp);
}
