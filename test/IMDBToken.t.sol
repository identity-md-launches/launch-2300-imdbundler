// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {IMDBToken} from "../src/IMDBToken.sol";

contract IMDBTokenTest is Test {
    IMDBToken token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new IMDBToken();
    }

    function test_supplyAndMetadata() public view {
        assertEq(token.name(), "IMDBundler");
        assertEq(token.symbol(), "IMDB");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function testFuzz_transferAndBurn(uint256 amount) public {
        amount = bound(amount, 0, 1e27);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(address(this)), 1e27 - amount);
        vm.prank(alice);
        token.burn(amount);
        assertEq(token.totalSupply(), 1e27 - amount);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_allowancesCannotStealOrBurnOthers() public {
        token.transfer(alice, 100);
        vm.prank(alice);
        token.approve(bob, 30);
        vm.prank(bob);
        token.transferFrom(alice, bob, 30);
        vm.expectRevert();
        vm.prank(bob);
        token.transferFrom(alice, bob, 1);
        vm.expectRevert();
        vm.prank(bob);
        token.burn(31);
        assertEq(token.balanceOf(alice), 70);
    }

    function test_invalidTransferAndAdminSelectorsFail() public {
        vm.expectRevert();
        token.transfer(address(0), 1);
        vm.expectRevert();
        vm.prank(alice);
        token.transfer(bob, 1);
        string[7] memory selectors = [
            "mint(address,uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "pause()",
            "initialize(address)",
            "setTax(uint256)"
        ];
        for (uint256 i; i < selectors.length; i++) {
            (bool ok,) = address(token).call(abi.encodeWithSignature(selectors[i], alice, 1e27));
            assertFalse(ok);
        }
        assertEq(token.totalSupply(), 1e27);
    }
}
