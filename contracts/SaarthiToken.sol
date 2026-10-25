// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SaarthiToken
 * @notice $SAARTHI — ERC-20 cashback token.
 *         Minted automatically when Saarthi AI saves money for the user.
 *         1 token per ₹10 saved.
 */
contract SaarthiToken {

    string  public constant name     = "Saarthi";
    string  public constant symbol   = "SAARTHI";
    uint8   public constant decimals = 18;

    uint256 public totalSupply;
    address public proofContract;   // Only SaarthiProof can mint
    address public owner;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyMinter() {
        require(msg.sender == proofContract || msg.sender == owner, "Not authorized to mint");
        _;
    }

    function setProofContract(address _proof) external {
        require(msg.sender == owner, "Not owner");
        proofContract = _proof;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
